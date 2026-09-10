const express = require("express");
const { pdfToPng } = require('pdf-to-png-converter');
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { getOpenAIClient } = require("../../config/openai");
const { uploadCV } = require("../../config/upload");
const { parsePdfBuffer } = require("../../shared/pdf");

const router = express.Router();

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

router.get("/cvs", requireAuth, async (req, res) => {
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

router.post("/cvs", requireAuth, uploadCV.single('cv'), async (req, res) => {
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

router.delete("/cvs/:id", requireAuth, async (req, res) => {
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

router.get("/cvs/:id/download", requireAuth, async (req, res) => {
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

module.exports = router;
