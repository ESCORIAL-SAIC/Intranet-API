
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

/* MATRIZ 9-BOX */

// Función auxiliar: Obtener gerencia/sector del usuario autenticado
// Función auxiliar: Obtener reportes directos del usuario (1 nivel jerárquico abajo via puestodependencia)
async function obtenerReportesDirectos(username) {
    try {
        const result = await pool.query(`
            SELECT
                e.id,
                e.descripcion as nombre,
                e.sector_id,
                s.nombre as sector_nombre,
                e.gerencia_id,
                g.nombre as gerencia_nombre,
                puesto.nombre as puesto,
                e.fechaingreso as tenure_date,
                (
                    EXTRACT(YEAR FROM AGE(NOW(), TO_DATE(e.fechaingreso, 'YYYYMMDD'))) * 12
                    + EXTRACT(MONTH FROM AGE(NOW(), TO_DATE(e.fechaingreso, 'YYYYMMDD')))
                )::numeric AS tenure_months
            FROM empleado e
            LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id
            LEFT JOIN gerencia g ON g.id = e.gerencia_id
            LEFT JOIN sector s ON s.id = e.sector_id
            LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
            WHERE puesto.dependencia_id  = (
                SELECT puesto1.id FROM ud_empleado udemp1
                LEFT JOIN ud_puestoorganigrama puesto1 ON udemp1.puestoorganigrama_id = puesto1.id
                WHERE usuario_sistema = $1
            )
            AND e.activestatus = 0
            ORDER BY e.descripcion ASC
        `, [username]);

        return result.rows;
    } catch (err) {
        console.log('Error obtener reportes directos:', err);
        return [];
    }
}

// GET: Obtener listado de registros 9-box (propios + subordinados en lectura)
app.get("/nuevebox", requireAuth, async(req, res) => {
    try {
        const username = req.user.username;

        const propiosResult = await pool.query(`
            SELECT *, true as es_propio
            FROM web.registro_9box
            WHERE creado_por = $1 OR creado_por IS NULL
            ORDER BY fecha_creacion DESC
        `, [username]);

        const subordinadosResult = await pool.query(`
            SELECT r.*, false as es_propio
            FROM web.registro_9box r
            JOIN ud_empleado ude_c ON ude_c.usuario_sistema = r.creado_por
            JOIN ud_puestoorganigrama puesto_c ON ude_c.puestoorganigrama_id = puesto_c.id
            WHERE puesto_c.dependencia_id = (
                SELECT puesto_sup.id FROM ud_empleado udemp_sup
                LEFT JOIN ud_puestoorganigrama puesto_sup ON udemp_sup.puestoorganigrama_id = puesto_sup.id
                WHERE udemp_sup.usuario_sistema = $1
                LIMIT 1
            )
            ORDER BY r.fecha_creacion DESC
        `, [username]);

        res.json({
            propios: propiosResult.rows,
            subordinados: subordinadosResult.rows
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo registros 9-box" });
    }
});

const EVALUACIONES_SELECT = `
    SELECT
        ev.id,
        ev.registro_id,
        ev.empleado_id,
        ev.competencias_score,
        ev.objetivos_score,
        ev.performance_score,
        ev.potential_score,
        ev.fit_score,
        ev.leader_potential,
        ev.commitment_score,
        ev.riesgo,
        ev.caja_sugerida,
        ev.caja_manual,
        ev.comentario,
        ev.en_pool,
        pers.nombre as empleado_nombre,
        s.nombre as area,
        g.nombre as gerencia,
        puesto.nombre as manager,
        ROUND((
            EXTRACT(YEAR FROM AGE(NOW(), TO_DATE(emp.fechaingreso, 'YYYYMMDD')))
            + EXTRACT(MONTH FROM AGE(NOW(), TO_DATE(emp.fechaingreso, 'YYYYMMDD'))) / 12.0
        )::numeric) AS tenure_years
    FROM web.evaluacion_9box ev
    LEFT JOIN empleado emp ON emp.id = ev.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
    LEFT JOIN ud_empleado ude ON ude.id = emp.boextension_id
    LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
`;

// GET: Obtener un registro específico con sus evaluaciones
app.get("/nuevebox/:id", requireAuth, async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;

        const registroData = await pool.query(
            "SELECT * FROM web.registro_9box WHERE id = $1",
            [registroId]
        );

        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }

        const registro = registroData.rows[0];
        const creadorUsername = registro.creado_por;

        let puedeEditar = false;
        let evaluacionesData = [];

        const esCreador = !creadorUsername || creadorUsername === username;

        if (esCreador) {
            // Creador: filtra sus reportes directos, puede editar
            puedeEditar = true;
            const empleadosDisponibles = await obtenerReportesDirectos(username);
            const empleadosIds = empleadosDisponibles.map(e => e.id);
            if (empleadosIds.length > 0) {
                const placeholders = empleadosIds.map((_, i) => `$${i + 2}`).join(',');
                evaluacionesData = await pool.query(
                    `${EVALUACIONES_SELECT} WHERE ev.registro_id = $1 AND ev.empleado_id IN (${placeholders}) ORDER BY emp.descripcion ASC`,
                    [registroId, ...empleadosIds]
                );
            }
        } else {
            // Verificar si el creador es reporte directo del usuario (vista de superior)
            const esSuperior = await pool.query(`
                SELECT 1 FROM ud_empleado udemp_creador
                JOIN ud_puestoorganigrama puesto_creador ON udemp_creador.puestoorganigrama_id = puesto_creador.id
                WHERE udemp_creador.usuario_sistema = $1
                AND puesto_creador.dependencia_id = (
                    SELECT puesto_sup.id FROM ud_empleado udemp_sup
                    LEFT JOIN ud_puestoorganigrama puesto_sup ON udemp_sup.puestoorganigrama_id = puesto_sup.id
                    WHERE udemp_sup.usuario_sistema = $2
                    LIMIT 1
                )
            `, [creadorUsername, username]);

            if (esSuperior.rows.length === 0) {
                return res.status(403).json({ error: "No tienes acceso a este registro" });
            }

            // Superior jerárquico: ve todo el registro, sin poder editar
            puedeEditar = false;
            evaluacionesData = await pool.query(
                `${EVALUACIONES_SELECT} WHERE ev.registro_id = $1 ORDER BY emp.descripcion ASC`,
                [registroId]
            );
        }

        res.json({
            registro,
            evaluaciones: evaluacionesData.rows || [],
            puede_editar: puedeEditar,
            alerta_distribucion: calcularAlertaDistribucion9box(evaluacionesData.rows || [])
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo registro 9-box" });
    }
});

// GET: Obtener empleados disponibles para evaluar del usuario autenticado
app.get("/nuevebox/:id/empleados-disponibles", requireAuth, async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;
        
        // Obtener información del usuario autenticado
        const infoUsuario = await obtenerGerenciaDelUsuario(username);
        if (!infoUsuario) {
            return res.status(403).json({ error: "No se puede determinar la gerencia/sector del usuario" });
        }
        
        // Obtener empleados que reportan directamente al usuario (1 nivel jerárquico abajo)
        const empleadosDisponibles = await obtenerReportesDirectos(username);
        
        // Obtener evaluaciones ya existentes
        const evaluacionesExistentes = await pool.query(`
            SELECT empleado_id FROM web.evaluacion_9box WHERE registro_id = $1
        `, [registroId]);
        
        const empleadosEvaluados = new Set(evaluacionesExistentes.rows.map(e => e.empleado_id));
        
        // Empleados pendientes (sin evaluar)
        const empleadosPendientes = empleadosDisponibles.filter(e => !empleadosEvaluados.has(e.id));
        
        res.json({
            disponibles: empleadosDisponibles,
            evaluados: Array.from(empleadosEvaluados),
            pendientes: empleadosPendientes,
            usuario_info: {
                gerencia_id: infoUsuario.gerencia_id,
                gerencia_nombre: infoUsuario.gerencia_nombre,
                sector: infoUsuario.sector
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo empleados disponibles" });
    }
});

/* Scoring 9-box asistido por IA, a partir de Genoma + Evaluación de desempeño */

const NUEVEBOX_SCORING_SYSTEM_PROMPT = `Sos un analista de People Analytics. Tu tarea es estimar el perfil de calibración 9-box de UN empleado a partir de los datos disponibles: resultados de una evaluación psicométrica externa (Genomawork) y/o resultados de la evaluación de desempeño interna (competencias calificadas de NIVEL 0 a NIVEL 4, siendo NIVEL 4 el máximo). Puede que solo tengas uno de los dos conjuntos de datos, o ambos: hacé la mejor estimación posible con lo que haya, y si falta alguno de los dos, aclaralo brevemente en el comentario.

Devolvé únicamente un JSON válido con esta forma exacta, sin texto adicional:
{
  "competencias_score": number,
  "objetivos_score": number,
  "performance_score": number,
  "potential_score": number,
  "fit_score": number,
  "leader_potential": number,
  "commitment_score": number,
  "comentario": "string"
}

Guía de cada campo:
- competencias_score (0.00 a 4.00): desempeño general en competencias blandas/técnicas.
- objetivos_score (0.00 a 4.00): orientación a resultados / cumplimiento de objetivos. Si no hay un dato explícito de objetivos, inferilo de competencias como "Orientación a los Resultados", "Planificación y Gestión" o "Iniciativa y Autonomía".
- performance_score (0.00 a 4.00): desempeño general, síntesis de las competencias evaluadas.
- potential_score (0.00 a 4.00): potencial de crecimiento futuro, combinando rasgos cognitivos/de aprendizaje de Genoma con competencias como "Pensamiento Estratégico" o "Desarrollo de Talento".
- fit_score (0 a 100): ajuste cultural/de rol. Si Genoma trae un FIT % o rasgos de cultura organizacional, priorizalos; si no hay datos de Genoma, estimalo de forma conservadora (cercano a 50) en base al desempeño.
- leader_potential (0 a 3, entero): potencial de liderazgo, en base a la competencia "Liderazgo" y rasgos de liderazgo de Genoma.
- commitment_score (0.00 a 4.00): compromiso, en base a la competencia "Compromiso" y rasgos de integridad/confiabilidad de Genoma.
- comentario: 2 a 3 oraciones breves en español (máximo 400 caracteres en total) explicando la recomendación y qué datos se usaron.

IMPORTANTE: No inventes datos que no estén presentes. Si la información es escasa, usá valores moderados (cercanos al centro de la escala) en vez de arriesgar un puntaje extremo sin evidencia, y aclaralo en el comentario.`;

async function obtenerDatosGenomaYDesempenoParaEmpleado(empleadoId) {
    const [genomaResult, desempenoResult] = await Promise.all([
        pool.query(
            `SELECT fecha, tipo_eval, evaluacion, resultado FROM web.genoma_registros WHERE empleado_id = $1 ORDER BY fecha DESC`,
            [empleadoId]
        ),
        pool.query(
            `SELECT fecha, encuesta, pregunta, puntuacion, usuario, usuario_evaluar
             FROM web.v_intranet_eval_desemp_completas_respuestas
             WHERE empleado_evaluar_id = $1
             ORDER BY fecha DESC`,
            [empleadoId]
        )
    ]);

    // Si la misma competencia fue evaluada por el propio empleado y por su superior, se prioriza la del superior.
    const desempenoPorClave = new Map();
    for (const row of desempenoResult.rows) {
        const clave = `${row.encuesta}||${row.pregunta}`;
        const esSuperior = row.usuario !== row.usuario_evaluar;
        const previa = desempenoPorClave.get(clave);
        if (!previa || (esSuperior && !previa.esSuperior)) {
            desempenoPorClave.set(clave, { fecha: row.fecha, encuesta: row.encuesta, pregunta: row.pregunta, puntuacion: row.puntuacion, esSuperior });
        }
    }

    return { genoma: genomaResult.rows, desempeno: Array.from(desempenoPorClave.values()) };
}

// Debe reflejar exactamente las mismas bandas que intranet-react/.../NueveBox/utils.js y constants.js,
// para que la caja sugerida por el backend coincida con la que recalcula el frontend.
function calcularCajaSugerida9box(performanceScore, potentialScore) {
    const bandaDesempeno = performanceScore < 1.6 ? 'low' : performanceScore < 2.6 ? 'mid' : 'high';
    const bandaPotencial = potentialScore < 1.7 ? 'low' : potentialScore < 2.4 ? 'mid' : 'high';
    const MATRIZ_CAJAS = {
        high: { low: 4, mid: 7, high: 9 },
        mid: { low: 2, mid: 5, high: 8 },
        low: { low: 1, mid: 3, high: 6 }
    };
    return MATRIZ_CAJAS[bandaDesempeno][bandaPotencial];
}

function clamp(valor, min, max, porDefecto) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return porDefecto;
    return Math.min(max, Math.max(min, n));
}

// No se evalúa (ni con IA ni manualmente) a colaboradores con esta antigüedad o menos:
// no hay historial suficiente de desempeño/potencial para ubicarlos en una caja.
const ANTIGUEDAD_MINIMA_MESES_9BOX = 6;

function tieneAntiguedadInsuficiente(tenureMonths) {
    const meses = Number(tenureMonths);
    return Number.isFinite(meses) && meses <= ANTIGUEDAD_MINIMA_MESES_9BOX;
}

// Rangos de referencia con respaldo de benchmark (ver info-prompts/distribucion-9box-referencia.html).
// Sirven solo para generar una alerta informativa al calibrar un registro, nunca para bloquear la carga.
const BENCHMARK_BLOQUES_9BOX = [
    { nombre: 'Solid performers', cajas: [2, 5, 8], min: 60, max: 70 },
    { nombre: 'High performers', cajas: [4, 7, 9], min: 15, max: 20 },
    { nombre: 'HIPOs totales', cajas: [8, 9], min: 5, max: 15 }
];

// Estimación proporcional por caja individual (sin benchmark directo, solo orientativa).
const BENCHMARK_CAJAS_9BOX = { 1: 5, 2: 30, 3: 7, 4: 10, 5: 25, 6: 5, 7: 6, 8: 10, 9: 2 };

// Muestra mínima para que comparar porcentajes contra el benchmark tenga sentido.
const MIN_EVALUADOS_PARA_ALERTA_DISTRIBUCION = 5;

// Alerta informativa (no bloqueante): compara la distribución real de un registro 9-box
// contra los rangos de referencia de la industria. Un desvío grande no implica que el
// dato esté mal, sino que conviene revisar el proceso de evaluación (ver disclaimer del reporte).
function calcularAlertaDistribucion9box(evaluaciones) {
    const ubicados = evaluaciones
        .map(ev => ev.caja_manual || ev.caja_sugerida)
        .filter(caja => caja != null)
        .map(Number);

    const total = ubicados.length;
    if (total < MIN_EVALUADOS_PARA_ALERTA_DISTRIBUCION) {
        return { evaluable: false, total_ubicados: total, advertencias: [] };
    }

    const conteoPorCaja = ubicados.reduce((acc, caja) => {
        acc[caja] = (acc[caja] || 0) + 1;
        return acc;
    }, {});

    const advertencias = [];

    for (const bloque of BENCHMARK_BLOQUES_9BOX) {
        const cantidad = bloque.cajas.reduce((sum, caja) => sum + (conteoPorCaja[caja] || 0), 0);
        const pct = Math.round((cantidad / total) * 1000) / 10;
        if (pct < bloque.min || pct > bloque.max) {
            advertencias.push({
                tipo: 'bloque',
                nombre: bloque.nombre,
                cajas: bloque.cajas,
                porcentaje_actual: pct,
                rango_esperado: [bloque.min, bloque.max],
                mensaje: `${bloque.nombre} está en ${pct}% de los evaluados (rango de referencia ${bloque.min}-${bloque.max}%). Puede valer la pena revisar el proceso de evaluación.`
            });
        }
    }

    for (const [caja, referencia] of Object.entries(BENCHMARK_CAJAS_9BOX)) {
        const cantidad = conteoPorCaja[caja] || 0;
        const pct = Math.round((cantidad / total) * 1000) / 10;
        const tolerancia = Math.max(referencia * 0.5, 5);
        if (Math.abs(pct - referencia) > tolerancia) {
            advertencias.push({
                tipo: 'caja',
                nombre: `Caja ${caja}`,
                cajas: [Number(caja)],
                porcentaje_actual: pct,
                referencia_orientativa: referencia,
                mensaje: `La caja ${caja} concentra ${pct}% de los evaluados (referencia orientativa ~${referencia}%, sin benchmark directo). Revisar si es consistente antes de asumir que el dato está mal.`
            });
        }
    }

    return { evaluable: true, total_ubicados: total, advertencias };
}

// Devuelve null si el empleado no tiene datos de Genoma ni de desempeño (no hay base para estimar nada).
async function calcularScores9boxConIA(empleadoId) {
    const { genoma, desempeno } = await obtenerDatosGenomaYDesempenoParaEmpleado(empleadoId);

    if (genoma.length === 0 && desempeno.length === 0) {
        return null;
    }

    const openai = getOpenAIClient('OPENAI_API_KEY');
    const aiResponse = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            { role: "system", content: [{ type: "input_text", text: NUEVEBOX_SCORING_SYSTEM_PROMPT }] },
            {
                role: "user",
                content: [{
                    type: "input_text",
                    text: `Datos de Genomawork (evaluación psicométrica):\n${genoma.length ? JSON.stringify(genoma) : "No hay datos de Genomawork para este empleado."}\n\nDatos de evaluación de desempeño (competencias NIVEL 0-4):\n${desempeno.length ? JSON.stringify(desempeno) : "No hay datos de evaluación de desempeño para este empleado."}`
                }]
            }
        ],
        text: { format: { type: "json_object" } },
        temperature: 0,
        max_output_tokens: 1024,
        store: false
    });

    const datos = JSON.parse(aiResponse.output_text);

    const performanceScore = clamp(datos.performance_score, 0, 4, 2);
    const potentialScore = clamp(datos.potential_score, 0, 4, 2);

    return {
        competencias_score: clamp(datos.competencias_score, 0, 4, 2),
        objetivos_score: clamp(datos.objetivos_score, 0, 4, 2),
        performance_score: performanceScore,
        potential_score: potentialScore,
        fit_score: clamp(datos.fit_score, 0, 100, 50),
        leader_potential: Math.round(clamp(datos.leader_potential, 0, 3, 0)),
        commitment_score: clamp(datos.commitment_score, 0, 4, 2),
        caja_sugerida: calcularCajaSugerida9box(performanceScore, potentialScore),
        comentario: typeof datos.comentario === 'string' ? datos.comentario.slice(0, 500) : ''
    };
}

// POST: Crear nuevo registro 9-box y cargar automáticamente empleados del usuario
app.post("/nuevebox", requireAuth, async(req, res) => {
    try {
        const { nombre, anio, estado } = req.body;
        const username = req.user.username;
        
        if (!nombre || !anio) {
            return res.status(400).json({ error: "Nombre y año son requeridos" });
        }
        
        // Obtener gerencia del usuario
        const infoUsuario = await obtenerGerenciaDelUsuario(username);
        if (!infoUsuario) {
            return res.status(403).json({ error: "No se puede determinar la gerencia/sector del usuario" });
        }
        
        const registroId = require('crypto').randomUUID();
        
        // Crear registro
        const registroResult = await pool.query(
            "INSERT INTO web.registro_9box (id, nombre, anio, estado, fecha_creacion, creado_por) VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING *",
            [registroId, nombre, anio, estado || 'borrador', username]
        );
        
        // Obtener empleados que reportan directamente al usuario (1 nivel jerárquico abajo)
        const empleadosDisponibles = await obtenerReportesDirectos(username);
        
        // Crear evaluaciones automáticamente para cada empleado, con scores sugeridos por IA
        // (en base a Genoma + evaluación de desempeño previas, si el empleado tiene algo cargado)
        if (empleadosDisponibles.length > 0) {
            const insertPromises = empleadosDisponibles.map(async emp => {
                // Antigüedad insuficiente: queda en el pool sin sugerencia de la IA (no hay
                // historial suficiente de desempeño/potencial para ubicarlo en una caja).
                if (tieneAntiguedadInsuficiente(emp.tenure_months)) {
                    return pool.query(
                        `INSERT INTO web.evaluacion_9box
                         (id, registro_id, empleado_id, competencias_score, objetivos_score,
                          performance_score, potential_score, fit_score, leader_potential,
                          commitment_score, riesgo, caja_sugerida, comentario, en_pool)
                         VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, 0, 'Bajo', NULL, $4, true)`,
                        [
                            require('crypto').randomUUID(),
                            registroId,
                            emp.id,
                            `Ingreso reciente (antigüedad de ${Math.floor(Number(emp.tenure_months))} meses): aún no evaluable en el modelo 9-box.`
                        ]
                    );
                }

                let scores = null;
                try {
                    scores = await calcularScores9boxConIA(emp.id);
                } catch (err) {
                    console.log(`[nuevebox-ia] error calculando scores para empleado_id=${emp.id}`, err);
                }

                const s = scores || {
                    competencias_score: 0, objetivos_score: 0, performance_score: 0, potential_score: 0,
                    fit_score: 0, leader_potential: 0, commitment_score: 0, caja_sugerida: null, comentario: ''
                };

                try {
                    return await pool.query(
                        `INSERT INTO web.evaluacion_9box
                         (id, registro_id, empleado_id, competencias_score, objetivos_score,
                          performance_score, potential_score, fit_score, leader_potential,
                          commitment_score, riesgo, caja_sugerida, comentario, en_pool)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            require('crypto').randomUUID(),
                            registroId,
                            emp.id,
                            s.competencias_score, s.objetivos_score, s.performance_score, s.potential_score,
                            s.fit_score, s.leader_potential, s.commitment_score,
                            'Bajo', // riesgo
                            s.caja_sugerida,
                            s.comentario,
                            s.caja_sugerida == null // en_pool: si la IA no pudo sugerir una caja (sin datos), queda pendiente de ubicar
                        ]
                    );
                } catch (err) {
                    // Si el insert falla (ej. por datos fuera de rango), reintentamos en blanco
                    // para que el empleado no quede completamente afuera del registro.
                    console.log(`[nuevebox-ia] error insertando evaluación de empleado_id=${emp.id}, se reintenta en blanco`, err);
                    return pool.query(
                        `INSERT INTO web.evaluacion_9box
                         (id, registro_id, empleado_id, competencias_score, objetivos_score,
                          performance_score, potential_score, fit_score, leader_potential,
                          commitment_score, riesgo, caja_sugerida, comentario, en_pool)
                         VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, 0, 'Bajo', NULL, '', true)`,
                        [require('crypto').randomUUID(), registroId, emp.id]
                    );
                }
            });

            await Promise.all(insertPromises);
        }
        
        res.status(201).json({
            success: true,
            message: `Registro creado con ${empleadosDisponibles.length} empleados cargados automáticamente`,
            data: {
                ...registroResult.rows[0],
                empleados_cargados: empleadosDisponibles.length,
                usuario_info: {
                    gerencia_id: infoUsuario.gerencia_id,
                    gerencia_nombre: infoUsuario.gerencia_nombre,
                    sector: infoUsuario.sector
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando registro 9-box" });
    }
});

// PUT: Actualizar estado del registro
app.put("/nuevebox/:id", requireAuth, async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;
        const { estado } = req.body;

        const ownership = await pool.query(
            "SELECT creado_por FROM web.registro_9box WHERE id = $1",
            [registroId]
        );
        if (ownership.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }

        const creadorUsername = ownership.rows[0].creado_por;
        if (creadorUsername && creadorUsername !== username) {
            return res.status(403).json({ error: "Solo el creador puede modificar el estado del registro" });
        }

        if (!['borrador', 'calibrado', 'publicado'].includes(estado)) {
            return res.status(400).json({ error: "Estado inválido" });
        }

        const fecha_cierre = estado === 'publicado' ? new Date() : null;

        const result = await pool.query(
            "UPDATE web.registro_9box SET estado = $1, fecha_cierre = $2 WHERE id = $3 RETURNING *",
            [estado, fecha_cierre, registroId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        
        res.json({
            success: true,
            message: "Registro actualizado correctamente",
            data: result.rows[0]
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando registro" });
    }
});

// PUT: Actualizar evaluación (caja manual y comentario)
app.put("/nuevebox/:id/evaluacion/:empleado_id", requireAuth, async(req, res) => {
    try {
        const { id: registroId, empleado_id: empleadoId } = req.params;
        const username = req.user.username;

        const ownership = await pool.query(
            "SELECT creado_por FROM web.registro_9box WHERE id = $1",
            [registroId]
        );
        const creadorUsername = ownership.rows[0]?.creado_por;
        if (creadorUsername && creadorUsername !== username) {
            return res.status(403).json({ error: "Solo el creador puede editar las evaluaciones" });
        }

        const { caja_manual, comentario, en_pool, competencias_score, objetivos_score, performance_score, potential_score, fit_score, leader_potential, commitment_score, riesgo } = req.body;

        if (caja_manual) {
            const antiguedad = await pool.query(
                `SELECT (
                    EXTRACT(YEAR FROM AGE(NOW(), TO_DATE(fechaingreso, 'YYYYMMDD'))) * 12
                    + EXTRACT(MONTH FROM AGE(NOW(), TO_DATE(fechaingreso, 'YYYYMMDD')))
                 )::numeric AS tenure_months
                 FROM empleado WHERE id = $1`,
                [empleadoId]
            );
            if (tieneAntiguedadInsuficiente(antiguedad.rows[0]?.tenure_months)) {
                return res.status(400).json({ error: `No se puede evaluar: el colaborador tiene ${ANTIGUEDAD_MINIMA_MESES_9BOX} meses o menos de antigüedad` });
            }
        }

        const result = await pool.query(
            `UPDATE web.evaluacion_9box
             SET caja_manual = $1,
                 comentario = $2,
                 en_pool = $3,
                 competencias_score = COALESCE($4, competencias_score),
                 objetivos_score = COALESCE($5, objetivos_score),
                 performance_score = COALESCE($6, performance_score),
                 potential_score = COALESCE($7, potential_score),
                 fit_score = COALESCE($8, fit_score),
                 leader_potential = COALESCE($9, leader_potential),
                 commitment_score = COALESCE($10, commitment_score),
                 riesgo = COALESCE($11, riesgo)
             WHERE registro_id = $12 AND empleado_id = $13 
             RETURNING *`,
            [
                caja_manual || null, 
                comentario || '', 
                en_pool !== undefined ? en_pool : false,
                competencias_score,
                objetivos_score,
                performance_score,
                potential_score,
                fit_score,
                leader_potential,
                commitment_score,
                riesgo,
                registroId, 
                empleadoId
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Evaluación no encontrada" });
        }
        
        res.json({
            success: true,
            message: "Evaluación actualizada correctamente",
            data: result.rows[0]
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando evaluación" });
    }
});

/* Análisis de informes Genomawork -> web.genoma_registros */

const { pdfToPng } = require('pdf-to-png-converter');

const GENOMA_SYSTEM_PROMPT = `Eres un extractor de datos de informes de evaluación de Genomawork. Vas a recibir las páginas del informe como IMÁGENES (una por página, en orden). Tu tarea es identificar CADA resultado de evaluación individual mencionado en el informe (cada rasgo, dimensión o indicador que tenga un puntaje o nivel propio, incluyendo los números que aparecen dentro de círculos/badges sobre las curvas y los valores de las barras en los gráficos) y devolverlos todos como una lista estructurada, sin resumir ni combinar varios en uno solo.

Un informe de Genomawork está organizado en secciones. Usá el título de la sección tal como aparece en el documento como "tipo_eval", por ejemplo: "Rasgos cognitivos", "Rasgos de personalidad", "Rasgos conductuales", "Liderazgo", "Integridad", "Habilidades colaborativas", "Evaluación de Cultura Organizacional", etc. Si una misma dimensión de liderazgo o de integridad aparece tanto en un gráfico (barras/círculo) como repetida en un texto narrativo con el mismo valor, incluila UNA sola vez (no dupliques el mismo ítem con el mismo valor bajo dos tipo_eval distintos).

Dentro de cada sección hay ítems individuales evaluados (por ejemplo: "Razonamiento deductivo", "Capacidad de planificación", "Responsabilidad", "Estimulación intelectual", "Confiabilidad", "Cooperación", "Grupal/Individual") — cada uno de estos nombres va en "evaluacion".

El "resultado" de cada evaluación se expresa de distintas formas según la sección, y tenés que leer el número o texto exacto tal como se ve en la imagen, SIN normalizar a otra escala:
- El número dentro del círculo/badge sobre la curva de distribución (rasgos cognitivos, de personalidad, conductuales), de 0 a 100. Ej: "69".
- La altura de cada barra en el gráfico de liderazgo (0 a 12 puntos), leyendo el eje Y con cuidado. Ej: "8".
- Un porcentaje junto a un nivel cualitativo (habilidades colaborativas). Ej: "25% - Medio".
- Una clasificación cualitativa (integridad). Ej: "RIESGO BAJO" o "RIESGO ALTO".
- Un puntaje "X puntos" mencionado en prosa (ej. Responsabilidad/Amabilidad/Neuroticismo dentro de Integridad).
- Una preferencia cualitativa (cultura organizacional). Ej: "Ligera preferencia por el ambiente grupal".

IMPORTANTE - No inventes datos: leé con atención cada imagen antes de responder. Si un número no es legible con claridad en la imagen (borroso, cortado, tapado, o realmente ausente), devolvé "resultado": null para ese ítem en vez de adivinar o completar con un valor plausible. Es preferible null que un dato no verificable.

Además del listado, extraé también estos datos generales si están visibles en la primera página o el encabezado del informe:
- "candidato": nombre completo del candidato/evaluado.
- "cargo": cargo o proceso para el que fue evaluado.
- "fecha_evaluacion": fecha del informe en formato YYYY-MM-DD si es legible, o null.
- "fit_pct": el porcentaje de FIT mostrado en el encabezado (solo el número, sin el símbolo %), o null si no aparece.
- "email": email de contacto si aparece, o null.
- "telefono": teléfono de contacto si aparece, o null.

Devolvé únicamente un JSON válido con este formato exacto, sin texto adicional:
{
  "candidato": "string o null",
  "cargo": "string o null",
  "fecha_evaluacion": "YYYY-MM-DD o null",
  "fit_pct": number o null,
  "email": "string o null",
  "telefono": "string o null",
  "resultados": [
    { "tipo_eval": "string", "evaluacion": "string", "resultado": "string o null" }
  ]
}`;

async function procesarInformeGenomaPdf(pdfBuffer, { empleadoId = null, fechaOverride = null } = {}) {
    const paginas = await pdfToPng(pdfBuffer, { viewportScale: 2.0, disableFontFace: true });
    const imagenes = paginas.map(p => ({
        type: "input_image",
        image_url: `data:image/png;base64,${p.content.toString('base64')}`
    }));

    const openai = getOpenAIClient('OPENAI_GENOMA_API_KEY');
    const aiResponse = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            {
                role: "system",
                content: [{ type: "input_text", text: GENOMA_SYSTEM_PROMPT }]
            },
            {
                role: "user",
                content: [
                    { type: "input_text", text: "Estas son las páginas del informe de Genomawork, en orden:" },
                    ...imagenes
                ]
            }
        ],
        text: { format: { type: "json_object" } },
        temperature: 0,
        max_output_tokens: 4096,
        store: false
    });

    const genomaDatos = JSON.parse(aiResponse.output_text);
    const resultados = Array.isArray(genomaDatos.resultados) ? genomaDatos.resultados : [];

    const fechaExtraida = genomaDatos.fecha_evaluacion && !isNaN(Date.parse(genomaDatos.fecha_evaluacion)) ? genomaDatos.fecha_evaluacion : null;
    const fecha = fechaOverride || fechaExtraida || new Date().toISOString().slice(0, 10);

    const insertPromises = resultados
        .filter(item => item && item.evaluacion)
        .map(item =>
            pool.query(
                `INSERT INTO web.genoma_registros (fecha, empleado_id, evaluacion, resultado, tipo_eval)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [
                    fecha,
                    empleadoId,
                    String(item.evaluacion).slice(0, 150),
                    item.resultado != null ? String(item.resultado).slice(0, 500) : null,
                    item.tipo_eval ? String(item.tipo_eval).slice(0, 150) : null
                ]
            )
        );

    const insertResults = await Promise.all(insertPromises);

    return { genomaDatos, fecha, insertResults };
}

app.post("/genoma", requireAuth, uploadGenoma.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Archivo PDF requerido" });

        const empleadoId = req.body.empleado_id || null;
        const fechaBody = req.body.fecha && !isNaN(Date.parse(req.body.fecha)) ? req.body.fecha : null;

        const { genomaDatos, fecha, insertResults } = await procesarInformeGenomaPdf(req.file.buffer, {
            empleadoId,
            fechaOverride: fechaBody
        });

        res.json({
            success: true,
            candidato: genomaDatos.candidato || null,
            cargo: genomaDatos.cargo || null,
            fecha_evaluacion: fecha,
            fit_pct: genomaDatos.fit_pct ?? null,
            email: genomaDatos.email || null,
            telefono: genomaDatos.telefono || null,
            registros_insertados: insertResults.length,
            data: insertResults.map(r => r.rows[0])
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error analizando informe de Genomawork" });
    }
});

/* Detección automática de informes Genomawork nuevos cargados en el ERP */

const cron = require('node-cron');

const GENOMA_ERP_QUERY = `
    SELECT v_l.id AS doc_link_id, emp.id AS empleado_id, v_l.xfilename, v_b.blobdata AS genoma_pdf
    FROM EMPLEADO emp
    JOIN V_BODBDOCLINK v_l ON emp.id = v_l.linkedobj_id
    JOIN blobs v_b ON v_b.id = v_l.data
    LEFT JOIN web.genoma_pdfs_procesados proc ON proc.doc_link_id = v_l.id
    WHERE v_l.xfilename ILIKE '%informe-candidato%'
      AND proc.id IS NULL
`;

async function procesarGenomaPdfsPendientesERP() {
    let rows;
    try {
        ({ rows } = await pool.query(GENOMA_ERP_QUERY));
    } catch (err) {
        console.log('[genoma-erp] error consultando informes pendientes', err);
        return;
    }

    if (rows.length === 0) return;

    console.log(`[genoma-erp] ${rows.length} informe(s) nuevo(s) detectado(s)`);

    for (const row of rows) {
        try {
            await procesarInformeGenomaPdf(row.genoma_pdf, { empleadoId: row.empleado_id });
            await pool.query(
                `INSERT INTO web.genoma_pdfs_procesados (doc_link_id, empleado_id, xfilename, estado)
                 VALUES ($1, $2, $3, 'ok')`,
                [row.doc_link_id, row.empleado_id, row.xfilename]
            );
        } catch (err) {
            console.log(`[genoma-erp] error procesando doc_link_id=${row.doc_link_id}`, err);
            try {
                await pool.query(
                    `INSERT INTO web.genoma_pdfs_procesados (doc_link_id, empleado_id, xfilename, estado, detalle_error)
                     VALUES ($1, $2, $3, 'error', $4)`,
                    [row.doc_link_id, row.empleado_id, row.xfilename, String(err.message || err).slice(0, 500)]
                );
            } catch (logErr) {
                console.log(`[genoma-erp] no se pudo registrar el error de doc_link_id=${row.doc_link_id}`, logErr);
            }
        }
    }
}

cron.schedule('0 * * * *', procesarGenomaPdfsPendientesERP);

module.exports = { procesarGenomaPdfsPendientesERP, procesarInformeGenomaPdf, calcularScores9boxConIA };

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