const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { getOpenAIClient } = require("../../config/openai");
const { obtenerGerenciaDelUsuario } = require("../../shared/organigrama");

const router = express.Router();

/* MATRIZ 9-BOX */

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
router.get("/nuevebox", requireAuth, async(req, res) => {
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
router.get("/nuevebox/:id", requireAuth, async(req, res) => {
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
router.get("/nuevebox/:id/empleados-disponibles", requireAuth, async(req, res) => {
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
router.post("/nuevebox", requireAuth, async(req, res) => {
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
router.put("/nuevebox/:id", requireAuth, async(req, res) => {
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
router.put("/nuevebox/:id/evaluacion/:empleado_id", requireAuth, async(req, res) => {
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

module.exports = router;
