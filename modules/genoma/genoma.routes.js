const express = require("express");
const cron = require('node-cron');
const { pdfToPng } = require('pdf-to-png-converter');
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { getOpenAIClient } = require("../../config/openai");
const { uploadGenoma } = require("../../config/upload");

const router = express.Router();

/* Análisis de informes Genomawork -> web.genoma_registros */

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

router.post("/genoma", requireAuth, uploadGenoma.single('pdf'), async (req, res) => {
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

module.exports = router;
