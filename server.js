
const express = require("express");
const app = express();
const cors = require("cors");
const fs = require("fs");
const path = require('path');
const { pool } = require("./config/db");
const session = require("express-session")
const flash = require("express-flash")
const passport = require("passport")
const jwt = require('jsonwebtoken')
const PdfReader = require('pdfreader').PdfReader;
const { parse } = require('csv-parse/sync');

require("dotenv").config();

require('./config/passportJWT')

const requireAuth = require('./middleware/requireAuth');
const { getOpenAIClient } = require('./config/openai');
const { uploadGenoma, uploadCV, uploadChatArchivos } = require('./config/upload');
const { perteneceGrupo } = require('./shared/grupos');
const { parsePdfBuffer } = require('./shared/pdf');
const { obtenerGerenciaDelUsuario } = require('./shared/organigrama');

app.use(cors());
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(passport.initialize())

app.use(flash())

app.use(require('./modules/auth/auth.routes'));
app.use(require('./modules/dashboard/dashboard.routes'));
app.use(require('./modules/explorador/explorador.routes'));
app.use(require('./modules/evaluaciones-desempenio/evaluaciones-desempenio.routes'));
app.use(require('./modules/estudios/estudios.routes'));
app.use(require('./modules/empleados/empleados.routes'));
app.use(require('./modules/reclutamiento/reclutamiento.routes'));
app.use(require('./modules/capacitacion/capacitacion.routes'));
app.use(require('./modules/conclave/conclave.routes'));
app.use(require('./modules/objetivos-gerencias/objetivos-gerencias.routes'));
app.use(require('./modules/objetivos-anuales/objetivos-anuales.routes'));
app.use(require('./modules/nuevebox/nuevebox.routes'));
app.use(require('./modules/genoma/genoma.routes'));

/* Carga CVs */

async function getEmpleadoId(username) {
    try {
        const result = await pool.query(
            "SELECT e.id FROM empleado e LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id WHERE ude.usuario_sistema = $1",
            [username]
        );
        return result.rows[0]?.id || null;
    } catch (err) {
        console.log(err);
        return null;
    }
}

app.get("/cvs", requireAuth, async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        const allDatas = await pool.query(
            "SELECT id, nombre_archivo, fecha, mime_type FROM web.intranet_cv WHERE empleado_id = $1 ORDER BY fecha DESC",
            [empleadoId]
        );
        res.json(allDatas.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo CVs" });
    }
});

app.post("/cvs", requireAuth, uploadCV.single('cv'), async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        if (!req.file) return res.status(400).json({ error: "Archivo requerido" });

        const nombre = req.body.nombre_archivo || req.file.originalname;

        const textoPdf = await parsePdfBuffer(req.file.buffer);

        // Si pdfreader no logra extraer texto (CV escaneado o compuesto por imágenes),
        // se procesan las páginas del PDF como imágenes con el modelo de visión.
        const TEXTO_MINIMO = 40;
        let userContent;
        if (textoPdf.trim().length >= TEXTO_MINIMO) {
            userContent = [{ type: "input_text", text: `Texto del CV:\n\n${textoPdf}` }];
        } else {
            const paginas = await pdfToPng(req.file.buffer, { viewportScale: 2.0, disableFontFace: true });
            userContent = [
                { type: "input_text", text: "Estas son las páginas del CV, en orden:" },
                ...paginas.map(p => ({
                    type: "input_image",
                    image_url: `data:image/png;base64,${p.content.toString('base64')}`
                }))
            ];
        }

        const openai = getOpenAIClient('OPENAI_API_KEY');
        const aiResponse = await openai.responses.create({
            model: "gpt-4.1",
            input: [
                {
                    role: "system",
                    content: [{
                        type: "input_text",
                        text: `Eres un extractor de información de currículums vitae. Dado el contenido de un CV (texto o imágenes de sus páginas), extraé la información estructurada y devolvé únicamente un JSON válido con este formato:
                    {
                        "nombre_completo": "string",
                        "email": "string",
                        "telefono": "string",
                        "direccion": "string",
                        "perfil_profesional": "string",
                        "experiencia_laboral": [{ "empresa": "string", "puesto": "string", "fecha_inicio": "string", "fecha_fin": "string", "descripcion": "string" }],
                        "educacion": [{ "institucion": "string", "titulo": "string", "fecha_inicio": "string", "fecha_fin": "string" }],
                        "habilidades": ["string"],
                        "idiomas": [{ "idioma": "string", "nivel": "string" }],
                        "certificaciones": ["string"]
                    }
                    Si un campo no está disponible usá null. Devolvé únicamente el JSON, sin texto adicional.`
                    }]
                },
                {
                    role: "user",
                    content: userContent
                }
            ],
            text: { format: { type: "json_object" } },
            temperature: 0,
            max_output_tokens: 2048,
            store: false
        });

        const cvDatos = JSON.parse(aiResponse.output_text);

        const result = await pool.query(
            "INSERT INTO web.intranet_cv (empleado_id, cv, nombre_archivo, mime_type, cv_datos) VALUES($1, $2, $3, $4, $5) RETURNING id, nombre_archivo, fecha, mime_type",
            [empleadoId, req.file.buffer, nombre, req.file.mimetype, JSON.stringify(cvDatos)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error subiendo CV" });
    }
});

app.delete("/cvs/:id", requireAuth, async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        await pool.query(
            "DELETE FROM web.intranet_cv WHERE id = $1 AND empleado_id = $2",
            [req.params.id, empleadoId]
        );
        res.sendStatus(200);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando CV" });
    }
});

app.get("/cvs/:id/download", requireAuth, async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        const result = await pool.query(
            "SELECT cv, nombre_archivo, mime_type FROM web.intranet_cv WHERE id = $1 AND empleado_id = $2",
            [req.params.id, empleadoId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "CV no encontrado" });
        const { cv, nombre_archivo, mime_type } = result.rows[0];
        res.setHeader('Content-Type', mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre_archivo || 'cv'}"`);
        res.send(cv);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error descargando CV" });
    }
});

/* Asistentes RRHH — chat multi-agente (exclusivo grupo 'rrhh') */

const PROMPT_EVAL_PUNTOS = `Rol: Actúa como un Consultor Senior de RRHH experto en Compensaciones y Desarrollo Organizacional para la empresa Escorial (empresa familiar argentina de 73 años, fabricante de cocinas, termotanques y calefones).

Tu Misión: Tu objetivo es valuar puestos de trabajo "Fuera de Convenio" utilizando el Método de Clasificación por Puntos definido en el Manual de la compañía (incluido a continuación). Tu meta es eliminar solapamientos salariales y detectar cuadros de reemplazo.

Contexto de Escorial:
- Cultura: Basada en Integridad, Trabajo en Equipo y Mejora Continua.
- Prioridad Estratégica: Seguridad, Salud y Medio Ambiente (responsabilidad de todos).
- Universo: Puestos desde Recepción hasta Gerencia de Primera Línea.

Reglas de Valuación (Manual):
Utilizarás una escala de 1.000 puntos distribuida en 15 competencias, cada una con 5 grados (G1=20%, G2=40%, G3=60%, G4=80%, G5=100% del peso del factor):
- Toma de Decisiones (10%)
- Orientación a Resultados (10%)
- Liderazgo (10%)
- Pensamiento Estratégico (8%)
- Planificación y Gestión (8%)
- Desarrollo del Talento (8%) - Crucial para cuadros de reemplazo.
- Conocimientos Técnicos (8%)
- Iniciativa y Autonomía (6%)
- Mejora Continua (6%)
- Resolución de Conflictos (6%)
- Trabajo en Equipo (6%)
- Compromiso/Integridad (5%)
- Flexibilidad/Adaptación (5%)
- Comunicación Eficaz (4%)
- Orientación al Cliente (4%)

Instrucciones de Trabajo:
Analiza los documentos adjuntos (Descripciones de Puesto) que el usuario te irá adjuntando de manera progresiva, uno o varios por mensaje. Preguntá si hay más archivos para cargar o si ya finalizó. Si el usuario responde "finalice" (o equivalente), el análisis debe cubrir todos los puestos adjuntados hasta ese momento. Como resumen al final del análisis, armá una tabla markdown con todos los puestos y el puntaje conseguido para que sea de fácil lectura.

Para cada puesto, asigná un Grado (1 al 5) en cada una de las 15 competencias, justificando tu elección según las funciones descritas en la Descripción de Puesto.

Calculá el puntaje total (suma de los 15 factores).

Clasificá el puesto en una de estas bandas:
- Banda A (851-1000 pts): Gerencial.
- Banda B (651-850 pts): Jefaturas / Especialistas Sr.
- Banda C (451-650 pts): Coordinación / Analistas SR.
- Banda D (251-450 pts): Analistas / Asistentes.

Identificá si el puesto requiere un "Cuadro de Reemplazo" basado en su complejidad (especialmente si el grado en Desarrollo del Talento y Conocimientos Técnicos es alto).

No evalúes a la persona que ocupa el cargo, sino los requisitos mínimos y responsabilidades que el puesto exige para ser exitoso.`;

const MANUAL_EVALUACION_PUNTOS_TEXTO = `--- MANUAL DE EVALUACIÓN DE PUESTOS POR PUNTOS (referencia oficial de Escorial) ---

Objetivo: Establecer una metodología objetiva, técnica y equitativa para determinar el valor relativo de cada puesto fuera de convenio, facilitar cuadros de reemplazo y planes de carrera, alinear responsabilidades con la visión estratégica, y eliminar inconsistencias y solapamientos salariales.

Alcance: Todas las posiciones fuera de convenio, desde niveles operativos (ej. Recepcionista) hasta niveles directivos (Gerencias).

Dimensiones (15 competencias agrupadas en 4 dimensiones):
- Dimensión Estratégica (24%): Toma de Decisiones, Pensamiento Estratégico, Iniciativa y Autonomía.
- Dimensión de Gestión (24%): Orientación a Resultados, Planificación y Gestión, Mejora Continua.
- Dimensión Relacional (28%): Liderazgo, Desarrollo del Talento, Trabajo en Equipo, Comunicación Eficaz.
- Dimensión Metodológica y Cultural (24%): Conocimientos Técnicos, Resolución de Conflictos, Orientación al Cliente, Compromiso, Flexibilidad-Adaptación.

Proceso: Paso 1) Usar la Descripción de Puesto vigente. Paso 2) Asignar Grado 1-5 por competencia comparando la DP contra la escala de grados. Paso 3) Multiplicar el grado por el valor de puntos de la Matriz de Puntuación. Paso 4) Sumar los 15 factores y ubicar en la Banda Salarial correspondiente.

DICCIONARIO DE COMPETENCIAS Y GRADOS:

1. DIMENSIÓN ESTRATÉGICA
Toma de Decisiones (10%):
 G1: Decisiones rutinarias sobre su propia tarea con supervisión directa.
 G2: Elige entre opciones predefinidas para resolver problemas operativos diarios.
 G3: Toma decisiones que afectan el flujo de trabajo de su sector basándose en el análisis de recursos.
 G4: Decisiones tácticas con impacto presupuestario y funcional en su área.
 G5: Decisiones estratégicas de alta complejidad que impactan en los resultados globales y la sustentabilidad de la empresa.
Pensamiento Estratégico (8%):
 G1: Comprende las tareas inmediatas y su impacto directo.
 G2: Entiende la relación entre su trabajo y los objetivos de su departamento.
 G3: Identifica tendencias y cambios en su entorno de trabajo inmediato.
 G4: Analiza y comprende cambios del entorno para determinar su impacto a corto y mediano plazo.
 G5: Visualiza y lidera con enfoque integral, alineando la organización con la visión a largo plazo.
Iniciativa y Autonomía (6%):
 G1: Requiere instrucciones detalladas y supervisión constante.
 G2: Actúa proactivamente en tareas sencillas sin esperar indicaciones.
 G3: Resuelve problemas comunes de forma independiente con criterio propio.
 G4: Implementa soluciones a retos nuevos con decisión e independencia de criterio.
 G5: Responde con rapidez y eficacia ante requerimientos críticos del entorno de negocio.

2. DIMENSIÓN DE GESTIÓN
Orientación a los Resultados (10%):
 G1: Realiza el trabajo asignado en el tiempo previsto.
 G2: Busca cumplir con los estándares de calidad y seguridad establecidos.
 G3: Moviliza recursos para superar desafíos y cumplir metas del sector.
 G4: Establece indicadores y realiza un seguimiento permanente para maximizar el rendimiento.
 G5: Supera consistentemente los resultados esperados bajo estándares de excelencia global.
Planificación y Gestión (8%):
 G1: Organiza sus actividades diarias siguiendo un cronograma dado.
 G2: Estructura acciones sencillas con plazos alcanzables.
 G3: Define metas y prioridades para su equipo de trabajo.
 G4: Realiza una gestión rigurosa mediante mecanismos de seguimiento y evaluación de riesgos.
 G5: Diseña y asegura el cumplimiento de planes complejos con visión a largo plazo.
Mejora Continua (6%):
 G1: Aplica los métodos y procesos de trabajo existentes.
 G2: Identifica oportunidades de mejora en su puesto de trabajo.
 G3: Propone soluciones creativas para optimizar recursos en su sector.
 G4: Genera valor mediante enfoques innovadores y métodos originales ante situaciones inesperadas.
 G5: Lidera la cultura de excelencia operacional y transformación de ideas en acción.

3. DIMENSIÓN RELACIONAL
Liderazgo (10%):
 G1: Colabora con compañeros sin ejercer rol de guía.
 G2: Actúa como referente técnico o guía para ingresos recientes.
 G3: Inspira y motiva a sus colaboradores directos hacia los objetivos.
 G4: Fomenta una cultura de aprendizaje continuo y optimización de procesos.
 G5: Comunica la visión estratégica y transmite los valores de Escorial a través de sus acciones.
Desarrollo del Talento (8%):
 G1: Se ocupa de su propio aprendizaje y actualización básica.
 G2: Identifica necesidades de capacitación propias para mejorar resultados.
 G3: Incentiva el desarrollo de conocimientos en su equipo inmediato.
 G4: Fomenta activamente la incorporación de nuevos conocimientos en el área.
 G5: Diseña e implementa planes de sucesión y cuadros de reemplazo estratégicos.
Trabajo en Equipo (6%):
 G1: Trabaja de forma individual respetando el entorno.
 G2: Colabora activamente con los miembros de su propio equipo.
 G3: Subordina intereses personales a los objetivos grupales del sector.
 G4: Trabaja con otras áreas para alcanzar la estrategia organizacional.
 G5: Elimina barreras y fomenta la colaboración integral en toda la compañía.
Comunicación Eficaz (4%):
 G1: Transmite información básica de manera correcta.
 G2: Escucha y entiende los requerimientos de sus pares.
 G3: Transmite de forma clara y oportuna la información requerida por los demás.
 G4: Mantiene redes de contacto formales e informales en diferentes niveles.
 G5: Asegura una comunicación abierta, transparente y alineada a los valores de la empresa.

4. DIMENSIÓN METODOLÓGICA Y CULTURAL
Conocimientos Técnicos (8%):
 G1: Posee conocimientos básicos para tareas de apoyo.
 G2: Demuestra experiencia específica requerida para la función a cargo.
 G3: Mantiene actualizados sus conocimientos en su campo de especialización.
 G4: Domina ampliamente su campo y comparte experiencias con otros.
 G5: Es referente técnico interno y externo en temas críticos para el negocio.
Resolución de Conflictos - Problemas (6%):
 G1: Reporta problemas para que otros los resuelvan.
 G2: Identifica relaciones causa-efecto en problemas técnicos sencillos.
 G3: Entiende situaciones desglosándolas en partes para encontrar soluciones prácticas.
 G4: Facilita el diálogo y promueve alternativas satisfactorias en conflictos interpersonales.
 G5: Asegura soluciones efectivas y sostenibles para problemas de alta complejidad.
Orientación al Cliente (4%):
 G1: Brinda una atención amable ante consultas básicas.
 G2: Comprende adecuadamente las demandas de clientes internos y externos.
 G3: Actúa con vocación permanente de servicio generando soluciones efectivas.
 G4: Supera las expectativas de los clientes priorizando la calidad y funcionalidad.
 G5: Diseña estrategias para maximizar la experiencia del cliente y la confianza sólida.
Compromiso - Integridad (5%):
 G1: Conoce los valores de la organización.
 G2: Cumple con las obligaciones personales y profesionales establecidas.
 G3: Se identifica con los valores actuando con integridad y honestidad.
 G4: Apoya e instrumenta decisiones alineando su comportamiento a las metas.
 G5: Honra todas sus acciones y acuerdos, siendo modelo de transparencia y ética.
Flexibilidad - Adaptación (5%):
 G1: Acepta cambios en su rutina de trabajo si se le indica.
 G2: Adapta su comportamiento a distintos contextos y personas de forma adecuada.
 G3: Modifica su enfoque ante situaciones cambiantes para alcanzar objetivos.
 G4: Identifica oportunidades de mejora en medios y situaciones inciertas.
 G5: Promueve la versatilidad organizacional y la agilidad ante retos del mercado.

MATRIZ DE PUNTUACIÓN (puntos por grado, según el peso de cada competencia):
Competencia | Peso | G1 | G2 | G3 | G4 | G5
Toma de Decisiones | 10% | 20 | 40 | 60 | 80 | 100
Pensamiento Estratégico | 8% | 16 | 32 | 48 | 64 | 80
Iniciativa y Autonomía | 6% | 12 | 24 | 36 | 48 | 60
Orientación a Resultados | 10% | 20 | 40 | 60 | 80 | 100
Planificación y Gestión | 8% | 16 | 32 | 48 | 64 | 80
Mejora Continua | 6% | 12 | 24 | 36 | 48 | 60
Liderazgo | 10% | 20 | 40 | 60 | 80 | 100
Desarrollo del Talento | 8% | 16 | 32 | 48 | 64 | 80
Trabajo en Equipo | 6% | 12 | 24 | 36 | 48 | 60
Comunicación Eficaz | 4% | 8 | 16 | 24 | 32 | 40
Conocimientos Técnicos | 8% | 16 | 32 | 48 | 64 | 80
Resolución de Conflictos | 6% | 12 | 24 | 36 | 48 | 60
Orientación al Cliente | 4% | 8 | 16 | 24 | 32 | 40
Compromiso | 5% | 10 | 20 | 30 | 40 | 50
Flexibilidad - Adaptación | 5% | 10 | 20 | 30 | 40 | 50
TOTAL: 100% / 1000 puntos máximos.

BANDAS SALARIALES:
- Banda A (851-1000 pts): Gerencia. Amplitud sugerida 40%. Lógica de pago: basado en impacto estratégico y bonos por resultados.
- Banda B (651-850 pts): Jefaturas. Amplitud sugerida 30%. Lógica de pago: basado en gestión de equipos y cumplimiento de KPIs.
- Banda C (451-650 pts): Analistas SR. Amplitud sugerida 25%. Lógica de pago: asegurar "gap" del 15% vs. mayor categoría de convenio.
- Banda D (251-450 pts): Analistas/Asistentes. Amplitud sugerida 20%. Lógica de pago: basado en especialización técnica.

Mantenimiento: este manual debe revisarse anualmente o cada vez que un puesto sufra una modificación significativa en sus funciones (mayor al 30%).
--- FIN DEL MANUAL ---`;

const PROMPT_GESTION_TALENTO = `ROL: Actúa como un experto en Gestión del Talento y Desarrollo Organizacional para la empresa Escorial. Tu especialidad es el cruce de datos entre la "Valuación del Puesto" y el "Desempeño Individual".

CONTEXTO Y OBJETIVO:
Ya contamos con una tabla de valuación de puestos por puntos. Tu misión ahora es cruzar esa información con los resultados de las evaluaciones de desempeño de los colaboradores para clasificarlos en dos categorías críticas para Escorial:

PERSONA CLAVE (Continuidad Operativa):
- Foco: Expertise técnico y criticidad del rol.
- Criterio: Personas con puntaje máximo en Conocimiento Técnico y Toma de Decisiones. Si su salida detiene la operación o se pierde conocimiento no documentado, es Clave.

PERSONA DE ALTO POTENCIAL (Crecimiento):
- Foco: Capacidad de aprendizaje y visión sistémica.
- Criterio: Personas cuyo desempeño en Pensamiento Estratégico, Liderazgo e Iniciativa supera los requerimientos del puesto que ocupan actualmente.

TUS TAREAS:
- Recibir y procesar: leerás la tabla de valuación de puestos que el usuario te adjunte.
- Cruzar con Desempeño: cuando te brinden los datos de un colaborador, compararás sus "competencias demostradas" contra los "puntos del puesto".
- Clasificar: determinarás si la persona es un Pilar (Cumple su puesto), una Persona Clave (Crítica) o un Alto Potencial (Ascendible).
- Sugerir Acción: propondrás una acción (ej: "Plan de retención" para Claves o "Plan de sucesión" para Alto Potencial).

FORMATO DE SALIDA:
Por cada persona analizada, entregá un breve informe:
- Nombre/Puesto:
- Puntaje del Puesto vs. Puntaje de la Persona:
- Clasificación Talent Escorial: (Clave / Alto Potencial / Estándar).
- Justificación: por qué encaja en esa definición según los criterios de Escorial.`;

const PROMPT_SELECCION_MATRIZ = `Actúa como un experto en selección y reclutamiento senior. Tu objetivo es realizar una evaluación exhaustiva e imparcial de uno o más Currículums Vitae (CVs) contra la Descripción de Puesto (DP). Debés generar un análisis detallado y presentar los hallazgos en una tabla comparativa clara, visual y fácil de interpretar.

Datos de entrada que el usuario te irá proporcionando (posiblemente en varios mensajes): Descripción de Puesto (DP), CV(s) de Candidato(s) (nombrando claramente a cada uno), Informe(s) de Entrevista por candidato.

Requisitos de la Tarea:

1. Extracción de Criterios Clave: identificá y extraé los 5 Criterios Técnicos más importantes y los 5 Criterios Culturales más importantes de la DP. Estos 10 puntos serán las filas principales de la matriz.

2. Análisis de Candidatos:
 - CV: evaluá la experiencia y habilidades de cada candidato directamente contra los 10 criterios clave extraídos de la DP.
 - Informe de Entrevista: extraé, de manera concisa, por cada candidato: Fortalezas; Riesgos/Puntos de Desarrollo; Motivación (alineación con la DP/empresa); Señales Culturales (alineación con los valores de la empresa/equipo).

3. Matriz Comparativa (tabla markdown):
 - Filas: los 10 Criterios Clave (5 Técnicos, 5 Culturales).
 - Columnas: un bloque de evaluación por cada candidato.
 - Nivel de Ajuste por criterio y candidato: Alto (Verde) = excede o cumple plenamente; Medio (Amarillo) = cumple parcialmente o experiencia transferible; Bajo (Rojo) = carece del requisito o evidencia insuficiente.
 - Contradicciones: en columna separada por candidato, detectá cualquier contradicción entre CV e Informe de Entrevista (o entre partes del informe), citando un ejemplo específico por cada una.

4. Análisis Comparativo (resumen en texto): comparación entre candidatos, destacando quién se ajusta mejor en criterios Técnicos y Culturales, Fortalezas y Riesgos clave de cada uno. Incluí Recomendaciones ("Avanza" / "No Avanzar" / "Avanzar c/observaciones").

Formato de salida: 1) Análisis Comparativo de texto primero. 2) Luego la Matriz Clara y Visual en tabla markdown (usando los niveles [Alto/Medio/Bajo] ya que no hay color real en texto).

Prohibiciones: no inventes información que no aparezca en los documentos presentados; ante duda, preguntá; si no conseguís un dato, colocá "no informado".`;

const PROMPT_TALENT_ACQUISITION = `Actúa como un Senior Technical Recruiter con 15 años de experiencia en selección de personal de diferentes puestos en plantas industriales, desde técnicos a perfiles gerenciales. Tené en cuenta que la empresa en la que te desenvolvés es una empresa familiar de 73 años, metalúrgica, de capital argentino, que fabrica cocinas, termotanques y calefones.

Contexto: el usuario te va a dar una Descripción de Puesto (JD) y currículums (posiblemente en varios mensajes). Tu objetivo es realizar un análisis comparativo crítico para determinar el "fit" de los candidatos. Tenés 2 tareas asignadas:

Tarea 1: Tabla Comparativa
Generá una tabla comparativa (markdown) que incluya a todos los candidatos con las siguientes coincidencias clave:
- Experiencia Técnica Requerida: mapear hard skills específicas.
- Experiencia en Proyectos Similares: identificar ejemplos de proyectos o responsabilidades que demuestren aplicación real de las habilidades del JD.
- Metodologías y Herramientas: coincidencia con metodologías específicas (ej. Scrum, ITIL, PMP) o herramientas de nicho.

Gaps (Brechas) y Riesgos:
- Gaps de Experiencia: identificar áreas donde la experiencia es nula o insuficiente según el JD.
- Riesgos de Fit: señalar la probabilidad de turnover (abandono) o mismatch (desajuste) basándose en la trayectoria del candidato (ej. saltos frecuentes, cambio drástico de rubro).

Evaluación Contextual (Pre-Filtro Humano):
- Seniority vs. Rol: determinar el nivel de seniority percibido (Junior, Semi-Senior, Senior, Lead) y si es adecuado para el JD.
- Tipo de Empresa: comparar si la experiencia previa (Startup, Corporación, PYME, Consultora) se alinea con la cultura/tamaño de la empresa que contrata.
- Idioma: confirmar el nivel de idioma requerido, si aplica (ej. Inglés Fluido/Técnico).
- Competencias Blandas (Soft Skills): inferir y evaluar al menos tres (3) competencias blandas clave (ej. Liderazgo, Comunicación, Adaptabilidad, Resolución de Problemas) basándote en la descripción de roles, logros y responsabilidades del CV.

Tarea 2: Guía de Entrevista Estandarizada
Basándote en los puntos débiles generales encontrados y los requisitos del puesto, redactá una guía de 5 preguntas situacionales (metodología STAR) que permitan nivelar a todos los candidatos por igual.

Formato de salida: presentá la tabla de forma clara (markdown) y luego la guía de preguntas en un listado numerado. Sé directo, honesto y evitá lenguaje genérico.`;

const AGENTES_CHAT = {
    'evaluacion-puntos': {
        nombre: 'Evaluación por Puntos',
        descripcion: 'Valúa puestos fuera de convenio con el método de clasificación por puntos (1000 pts, 15 competencias) y detecta necesidad de cuadros de reemplazo.',
        systemPrompt: `${PROMPT_EVAL_PUNTOS}\n\n${MANUAL_EVALUACION_PUNTOS_TEXTO}`
    },
    'gestion-talento': {
        nombre: 'Gestión del Talento',
        descripcion: 'Cruza la valuación de puestos con el desempeño individual para identificar Personas Clave y de Alto Potencial.',
        systemPrompt: PROMPT_GESTION_TALENTO
    },
    'seleccion-matriz': {
        nombre: 'Selección — Matriz Comparativa',
        descripcion: 'Compara CVs e informes de entrevista contra una Descripción de Puesto en una matriz visual por criterios técnicos y culturales.',
        systemPrompt: PROMPT_SELECCION_MATRIZ
    },
    'talent-acquisition': {
        nombre: 'Talent Acquisition',
        descripcion: 'Análisis crítico de fit técnico/cultural entre candidatos y una Descripción de Puesto, con guía de entrevista STAR.',
        systemPrompt: PROMPT_TALENT_ACQUISITION
    }
};

async function requireRRHH(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: "'rrhh'" });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para RRHH" });
        return false;
    }
    return true;
}

// Extrae el contenido de un archivo adjunto (PDF) como bloques de contenido para el input de OpenAI,
// y devuelve también el texto plano (para persistir y poder reconstruir el historial en turnos futuros).
async function procesarArchivoChat(file) {
    const textoPdf = await parsePdfBuffer(file.buffer).catch(() => '');
    if (textoPdf.trim().length >= 40) {
        return {
            textoExtraido: textoPdf,
            contenido: [{ type: "input_text", text: `--- Documento adjunto: ${file.originalname} ---\n${textoPdf}` }]
        };
    }
    // PDF escaneado / sin texto extraíble: se procesa como imágenes solo para este turno.
    const paginas = await pdfToPng(file.buffer, { viewportScale: 2.0, disableFontFace: true });
    return {
        textoExtraido: null,
        contenido: [
            { type: "input_text", text: `--- Documento adjunto (imágenes): ${file.originalname} ---` },
            ...paginas.map(p => ({ type: "input_image", image_url: `data:image/png;base64,${p.content.toString('base64')}` }))
        ]
    };
}

app.get("/chat-agentes", requireAuth, async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const lista = Object.entries(AGENTES_CHAT).map(([key, a]) => ({ key, nombre: a.nombre, descripcion: a.descripcion }));
        res.json(lista);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo agentes" });
    }
});

app.get("/chat-conversaciones", requireAuth, async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const { agente_key } = req.query;
        const params = [req.user.username];
        let where = "usuario = $1";
        if (agente_key) {
            params.push(agente_key);
            where += " AND agente_key = $2";
        }
        const result = await pool.query(
            `SELECT id, agente_key, titulo, fecha_creacion, fecha_actualizacion FROM web.chat_agente_conversacion WHERE ${where} ORDER BY fecha_actualizacion DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo conversaciones" });
    }
});

app.post("/chat-conversaciones", requireAuth, async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const { agente_key, titulo } = req.body;
        if (!agente_key || !AGENTES_CHAT[agente_key]) {
            return res.status(400).json({ error: "agente_key inválido" });
        }
        const id = require('crypto').randomUUID();
        const result = await pool.query(
            `INSERT INTO web.chat_agente_conversacion (id, agente_key, usuario, titulo, fecha_creacion, fecha_actualizacion)
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
            [id, agente_key, req.user.username, titulo || AGENTES_CHAT[agente_key].nombre]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando conversación" });
    }
});

app.get("/chat-conversaciones/:id", requireAuth, async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const conv = await pool.query(
            "SELECT * FROM web.chat_agente_conversacion WHERE id = $1 AND usuario = $2",
            [req.params.id, req.user.username]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: "Conversación no encontrada" });

        const mensajes = await pool.query(
            "SELECT id, rol, contenido, fecha FROM web.chat_agente_mensaje WHERE conversacion_id = $1 ORDER BY fecha ASC",
            [req.params.id]
        );
        const archivos = await pool.query(
            `SELECT id, mensaje_id, nombre_archivo, mime_type, fecha FROM web.chat_agente_archivo
             WHERE mensaje_id IN (SELECT id FROM web.chat_agente_mensaje WHERE conversacion_id = $1)`,
            [req.params.id]
        );
        const archivosPorMensaje = archivos.rows.reduce((acc, a) => {
            (acc[a.mensaje_id] = acc[a.mensaje_id] || []).push(a);
            return acc;
        }, {});

        res.json({
            conversacion: conv.rows[0],
            mensajes: mensajes.rows.map(m => ({ ...m, archivos: archivosPorMensaje[m.id] || [] }))
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo conversación" });
    }
});

app.delete("/chat-conversaciones/:id", requireAuth, async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        await pool.query(
            "DELETE FROM web.chat_agente_conversacion WHERE id = $1 AND usuario = $2",
            [req.params.id, req.user.username]
        );
        res.sendStatus(200);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando conversación" });
    }
});

app.post("/chat-conversaciones/:id/mensajes", requireAuth, uploadChatArchivos.array('archivos'), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const conv = await pool.query(
            "SELECT * FROM web.chat_agente_conversacion WHERE id = $1 AND usuario = $2",
            [req.params.id, req.user.username]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: "Conversación no encontrada" });
        const conversacion = conv.rows[0];
        const agente = AGENTES_CHAT[conversacion.agente_key];
        if (!agente) return res.status(400).json({ error: "Agente inválido para esta conversación" });

        const contenidoUsuario = req.body.contenido || '';
        const archivos = req.files || [];

        // Procesa los adjuntos de este turno (texto o imágenes según corresponda).
        const archivosProcesados = await Promise.all(archivos.map(async file => ({
            file,
            ...(await procesarArchivoChat(file))
        })));

        // Reconstruye el historial completo (store:false => sin estado en OpenAI, se arma todo el input cada vez).
        const historial = await pool.query(
            `SELECT m.id, m.rol, m.contenido, a.nombre_archivo, a.texto_extraido
             FROM web.chat_agente_mensaje m
             LEFT JOIN web.chat_agente_archivo a ON a.mensaje_id = m.id
             WHERE m.conversacion_id = $1 ORDER BY m.fecha ASC`,
            [req.params.id]
        );

        const mensajesPorId = new Map();
        for (const row of historial.rows) {
            if (!mensajesPorId.has(row.id)) {
                mensajesPorId.set(row.id, { rol: row.rol, contenido: row.contenido, archivos: [] });
            }
            if (row.nombre_archivo) {
                mensajesPorId.get(row.id).archivos.push({ nombre_archivo: row.nombre_archivo, texto_extraido: row.texto_extraido });
            }
        }

        const inputHistorial = Array.from(mensajesPorId.values()).map(m => {
            const tipoTexto = m.rol === 'assistant' ? 'output_text' : 'input_text';
            const content = [{ type: tipoTexto, text: m.contenido || '' }];
            if (m.rol === 'user') {
                for (const a of m.archivos) {
                    content.push({
                        type: 'input_text',
                        text: a.texto_extraido
                            ? `--- Documento adjunto: ${a.nombre_archivo} ---\n${a.texto_extraido}`
                            : `--- Documento adjunto: ${a.nombre_archivo} (contenido no extraíble como texto) ---`
                    });
                }
            }
            return { role: m.rol, content };
        });

        const contenidoTurnoActual = [
            { type: "input_text", text: contenidoUsuario },
            ...archivosProcesados.flatMap(a => a.contenido)
        ];

        const openai = getOpenAIClient('OPENAI_ASISTENTESRRHH_KEY');
        const aiResponse = await openai.responses.create({
            model: "gpt-4.1",
            input: [
                { role: "system", content: [{ type: "input_text", text: agente.systemPrompt }] },
                ...inputHistorial,
                { role: "user", content: contenidoTurnoActual }
            ],
            temperature: 0.3,
            max_output_tokens: 4096,
            store: false
        });

        const respuestaTexto = aiResponse.output_text || '';

        // Persistir mensaje de usuario + archivos adjuntos
        const mensajeUsuarioId = require('crypto').randomUUID();
        await pool.query(
            "INSERT INTO web.chat_agente_mensaje (id, conversacion_id, rol, contenido, fecha) VALUES ($1, $2, 'user', $3, NOW())",
            [mensajeUsuarioId, req.params.id, contenidoUsuario]
        );
        for (const a of archivosProcesados) {
            await pool.query(
                `INSERT INTO web.chat_agente_archivo (id, mensaje_id, nombre_archivo, mime_type, archivo, texto_extraido, fecha)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [require('crypto').randomUUID(), mensajeUsuarioId, a.file.originalname, a.file.mimetype, a.file.buffer, a.textoExtraido]
            );
        }

        // Persistir respuesta del asistente
        const mensajeAsistenteId = require('crypto').randomUUID();
        await pool.query(
            "INSERT INTO web.chat_agente_mensaje (id, conversacion_id, rol, contenido, fecha) VALUES ($1, $2, 'assistant', $3, NOW())",
            [mensajeAsistenteId, req.params.id, respuestaTexto]
        );

        await pool.query(
            "UPDATE web.chat_agente_conversacion SET fecha_actualizacion = NOW() WHERE id = $1",
            [req.params.id]
        );

        res.json({
            mensaje_usuario: { id: mensajeUsuarioId, rol: 'user', contenido: contenidoUsuario, archivos: archivosProcesados.map(a => ({ nombre_archivo: a.file.originalname, mime_type: a.file.mimetype })) },
            mensaje_asistente: { id: mensajeAsistenteId, rol: 'assistant', contenido: respuestaTexto, archivos: [] }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error procesando el mensaje" });
    }
});

/* PUERTO */

if (require.main === module) {
    app.listen(process.env.PORT, () => {
        console.log("Server has started on port "+process.env.PORT)
    });
}