const express = require("express");
const crypto = require("crypto");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { perteneceGrupo } = require("../../shared/grupos");
const { obtenerGerenciaDelUsuario } = require("../../shared/organigrama");

const router = express.Router();

/* RRHH INDUCCIÓN — Roadmap/checklist de inducción para nuevos colaboradores
   Solo RRHH crea, edita y publica roadmaps, y marca cada inducción como completada.
   Al crear uno, elige al colaborador de un listado de ingresos recientes (tabla empleado).
   El colaborador ve su roadmap publicado en Perfil (/induccion/mi-induccion) y, cuando
   completó todas las inducciones, responde la encuesta de satisfacción que cierra el
   proceso. Esquema en RRHH_INDUCCION_DDL.sql. */

const GRUPO_RRHH = "'rrhh'";

const TIPOS = ['estandar', 'jefatura'];

// Ventana (en días desde la fecha de ingreso) para considerar a un empleado como "nuevo".
// empleado no tiene timestamp de alta: se usa fechaingreso (texto 'YYYYMMDD').
const DIAS_NUEVO_DEFAULT = 60;

async function requireRRHH(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: GRUPO_RRHH });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para RRHH" });
        return false;
    }
    return true;
}

function calcularProgreso(items, encuestaCompletada) {
    const total = items.length + 1; // inducciones + encuesta
    const completadas = items.filter(i => i.completada).length + (encuestaCompletada ? 1 : 0);
    return { total, completadas, porcentaje: Math.round((completadas / total) * 100) };
}

async function obtenerItems(roadmapId, client = pool) {
    const result = await client.query(
        `SELECT id, roadmap_id, catalogo_id, orden, nombre,
                TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, TO_CHAR(horario, 'HH24:MI') AS horario,
                duracion_min, ubicacion, facilitador, material_url, requiere_evaluacion, evaluacion_url,
                observaciones, completada, fecha_completada, completada_por
         FROM web.induccion_roadmap_item WHERE roadmap_id = $1 ORDER BY orden ASC`,
        [roadmapId]
    );
    return result.rows;
}

async function obtenerRoadmapCompleto(roadmapId) {
    // fecha_ingreso se pisa como texto 'YYYY-MM-DD' (pg arma la fila por orden de columnas).
    const result = await pool.query(
        "SELECT *, TO_CHAR(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso FROM web.induccion_roadmap WHERE id = $1",
        [roadmapId]
    );
    if (result.rows.length === 0) return null;
    const roadmap = result.rows[0];
    const items = await obtenerItems(roadmapId);
    return { ...roadmap, items, progreso: calcularProgreso(items, roadmap.encuesta_completada) };
}

// Pasa a 'finalizado' cuando todo está completo (inducciones + encuesta) y vuelve a
// 'publicado' si RRHH desmarca algo. Un borrador no cambia de estado acá.
async function actualizarEstadoFinal(roadmapId, client = pool) {
    await client.query(`
        UPDATE web.induccion_roadmap r
        SET estado = CASE
                WHEN r.encuesta_completada AND NOT EXISTS (
                    SELECT 1 FROM web.induccion_roadmap_item i WHERE i.roadmap_id = r.id AND NOT i.completada
                ) THEN 'finalizado'
                ELSE 'publicado'
            END
        WHERE r.id = $1 AND r.estado <> 'borrador'
    `, [roadmapId]);
}

function validarItems(items, estado) {
    if (!Array.isArray(items) || items.length === 0) {
        return "El roadmap debe tener al menos una inducción";
    }
    for (const item of items) {
        if (!item.nombre || !String(item.nombre).trim()) {
            return "Todas las inducciones deben tener nombre";
        }
        if (estado === 'publicado' && (!item.fecha || !item.horario)) {
            return `Para publicar, la inducción "${item.nombre}" debe tener fecha y horario`;
        }
    }
    return null;
}

// Inserta o actualiza los items enviados (en el orden recibido) y elimina los que ya no
// están. Los items existentes conservan su estado de completada.
async function guardarItems(client, roadmapId, items) {
    const existentes = await obtenerItems(roadmapId, client);
    const idsExistentes = new Set(existentes.map(i => i.id));
    const idsRecibidos = new Set(items.filter(i => i.id).map(i => i.id));

    for (const existente of existentes) {
        if (!idsRecibidos.has(existente.id)) {
            await client.query("DELETE FROM web.induccion_roadmap_item WHERE id = $1", [existente.id]);
        }
    }

    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const valores = [
            index + 1,
            String(item.nombre).trim(),
            item.fecha || null,
            item.horario || null,
            parseInt(item.duracion_min, 10) || 30,
            item.ubicacion || null,
            item.facilitador || null,
            item.material_url || null,
            !!item.requiere_evaluacion,
            item.evaluacion_url || null,
            item.observaciones || null,
        ];
        if (item.id && idsExistentes.has(item.id)) {
            await client.query(`
                UPDATE web.induccion_roadmap_item
                SET orden = $1, nombre = $2, fecha = $3, horario = $4, duracion_min = $5, ubicacion = $6,
                    facilitador = $7, material_url = $8, requiere_evaluacion = $9, evaluacion_url = $10, observaciones = $11
                WHERE id = $12 AND roadmap_id = $13
            `, [...valores, item.id, roadmapId]);
        } else {
            await client.query(`
                INSERT INTO web.induccion_roadmap_item
                    (id, roadmap_id, catalogo_id, orden, nombre, fecha, horario, duracion_min, ubicacion,
                     facilitador, material_url, requiere_evaluacion, evaluacion_url, observaciones)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `, [crypto.randomUUID(), roadmapId, item.catalogo_id || null, ...valores]);
        }
    }
}

function datosCabecera(body) {
    return [
        body.tipo,
        body.sector || null,
        body.planta || null,
        body.fecha_ingreso || null,
        body.jefe_directo || null,
        body.tutor_rrhh || null,
        JSON.stringify(body.info_util || {}),
    ];
}

/* ==================================== CATÁLOGO ==================================== */

router.get("/induccion/catalogo", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const result = await pool.query(
            "SELECT * FROM web.induccion_catalogo WHERE activo ORDER BY categoria ASC, orden ASC, nombre ASC"
        );
        res.json({ catalogo: result.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el catálogo de inducciones" });
    }
});

/* ============================ EMPLEADOS (ingresos recientes) ============================ */

router.get("/induccion/empleados-nuevos", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const dias = parseInt(req.query.dias, 10) || DIAS_NUEVO_DEFAULT;
        // El CASE garantiza que TO_DATE solo se evalúe sobre valores con formato válido
        // (PG no asegura el orden de evaluación de las condiciones del WHERE).
        const result = await pool.query(`
            SELECT nuevos.*, TO_CHAR(ingreso, 'YYYY-MM-DD') AS fecha_ingreso FROM (
                SELECT
                    e.id,
                    e.descripcion AS nombre,
                    e.codigo AS legajo,
                    puesto.nombre AS puesto,
                    s.nombre AS sector,
                    g.nombre AS gerencia,
                    CASE WHEN e.fechaingreso ~ '^[0-9]{8}$' THEN TO_DATE(e.fechaingreso, 'YYYYMMDD') END AS ingreso,
                    r.id AS roadmap_id,
                    r.estado AS roadmap_estado
                FROM empleado e
                LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id
                LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
                LEFT JOIN sector s ON s.id = e.sector_id
                LEFT JOIN gerencia g ON g.id = e.gerencia_id
                LEFT JOIN web.induccion_roadmap r ON r.empleado_id = e.id
                WHERE e.activestatus = 0
            ) nuevos
            WHERE ingreso >= CURRENT_DATE - $1::integer
            ORDER BY ingreso DESC, nombre ASC
        `, [dias]);
        const empleados = result.rows.map(({ ingreso, ...e }) => e);
        res.json({ empleados, dias });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los empleados nuevos" });
    }
});

// Buscador de empleados activos (selección del facilitador de cada inducción).
router.get("/induccion/empleados/buscar", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const texto = String(req.query.q || '').trim();
        if (texto.length < 2) {
            return res.json({ empleados: [] });
        }
        const result = await pool.query(`
            SELECT
                e.id,
                e.descripcion AS nombre,
                e.codigo AS legajo,
                puesto.nombre AS puesto,
                s.nombre AS sector
            FROM empleado e
            LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id
            LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
            LEFT JOIN sector s ON s.id = e.sector_id
            WHERE e.activestatus = 0
              AND (e.descripcion ILIKE $1 OR e.codigo::text ILIKE $1)
            ORDER BY e.descripcion ASC
            LIMIT 20
        `, [`%${texto}%`]);
        res.json({ empleados: result.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error buscando empleados" });
    }
});

// Datos para precargar la sección "Datos del colaborador" del roadmap.
router.get("/induccion/empleados/:id/datos", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const result = await pool.query(`
            SELECT
                e.id,
                e.descripcion AS nombre,
                e.codigo AS legajo,
                puesto.nombre AS puesto,
                s.nombre AS sector,
                CASE WHEN e.fechaingreso ~ '^[0-9]{8}$' THEN TO_CHAR(TO_DATE(e.fechaingreso, 'YYYYMMDD'), 'YYYY-MM-DD') END AS fecha_ingreso,
                (
                    SELECT jefe.descripcion
                    FROM ud_empleado ude_jefe
                    JOIN empleado jefe ON jefe.boextension_id = ude_jefe.id AND jefe.activestatus = 0
                    WHERE ude_jefe.puestoorganigrama_id = puesto.dependencia_id
                    LIMIT 1
                ) AS jefe_directo
            FROM empleado e
            LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id
            LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
            LEFT JOIN sector s ON s.id = e.sector_id
            WHERE e.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Empleado no encontrado" });
        }
        res.json({ empleado: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los datos del empleado" });
    }
});

/* ==================================== ROADMAPS (RRHH) ==================================== */

router.get("/induccion/roadmaps", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const result = await pool.query(`
            SELECT
                r.id, r.empleado_id, r.tipo, r.nombre_snapshot, r.legajo_snapshot, r.puesto_snapshot,
                r.sector, r.planta, TO_CHAR(r.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, r.estado, r.encuesta_completada, r.fecha_creacion,
                COUNT(i.id)::integer AS total_inducciones,
                COUNT(i.id) FILTER (WHERE i.completada)::integer AS inducciones_completadas,
                TO_CHAR(MIN(i.fecha) FILTER (WHERE NOT i.completada), 'YYYY-MM-DD') AS proxima_fecha
            FROM web.induccion_roadmap r
            LEFT JOIN web.induccion_roadmap_item i ON i.roadmap_id = r.id
            GROUP BY r.id
            ORDER BY r.fecha_creacion DESC
        `);
        const roadmaps = result.rows.map(r => {
            const total = r.total_inducciones + 1;
            const completadas = r.inducciones_completadas + (r.encuesta_completada ? 1 : 0);
            return { ...r, progreso: { total, completadas, porcentaje: Math.round((completadas / total) * 100) } };
        });
        res.json({ roadmaps });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los roadmaps" });
    }
});

router.get("/induccion/roadmaps/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const roadmap = await obtenerRoadmapCompleto(req.params.id);
        if (!roadmap) {
            return res.status(404).json({ error: "Roadmap no encontrado" });
        }
        res.json({ roadmap });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el roadmap" });
    }
});

router.post("/induccion/roadmaps", requireAuth, async(req, res) => {
    const client = await pool.connect();
    try {
        if (!(await requireRRHH(req, res))) return;

        const { empleado_id, tipo, items } = req.body;
        const estado = req.body.estado === 'publicado' ? 'publicado' : 'borrador';
        if (!empleado_id) {
            return res.status(400).json({ error: "Debe seleccionar un colaborador" });
        }
        if (!TIPOS.includes(tipo)) {
            return res.status(400).json({ error: "Tipo de inducción inválido" });
        }
        const errorItems = validarItems(items, estado);
        if (errorItems) {
            return res.status(400).json({ error: errorItems });
        }

        const existente = await client.query("SELECT 1 FROM web.induccion_roadmap WHERE empleado_id = $1", [empleado_id]);
        if (existente.rows.length > 0) {
            return res.status(409).json({ error: "El colaborador ya tiene un roadmap de inducción" });
        }

        const empleadoData = await client.query(`
            SELECT e.descripcion AS nombre, e.codigo AS legajo, puesto.nombre AS puesto
            FROM empleado e
            LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id
            LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
            WHERE e.id = $1
        `, [empleado_id]);
        if (empleadoData.rows.length === 0) {
            return res.status(404).json({ error: "Empleado no encontrado" });
        }
        const empleado = empleadoData.rows[0];

        await client.query('BEGIN');
        const roadmapId = crypto.randomUUID();
        await client.query(`
            INSERT INTO web.induccion_roadmap
                (id, empleado_id, nombre_snapshot, legajo_snapshot, puesto_snapshot, tipo, sector, planta,
                 fecha_ingreso, jefe_directo, tutor_rrhh, info_util, estado, fecha_publicacion, creado_por, fecha_creacion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    CASE WHEN $14::boolean THEN NOW() END, $15, NOW())
        `, [roadmapId, empleado_id, empleado.nombre, empleado.legajo, empleado.puesto,
            ...datosCabecera(req.body), estado, estado === 'publicado', req.user.username]);
        await guardarItems(client, roadmapId, items);
        await client.query('COMMIT');

        res.status(201).json({ roadmap: await obtenerRoadmapCompleto(roadmapId) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(err);
        res.status(500).json({ error: "Error creando el roadmap" });
    } finally {
        client.release();
    }
});

router.put("/induccion/roadmaps/:id", requireAuth, async(req, res) => {
    const client = await pool.connect();
    try {
        if (!(await requireRRHH(req, res))) return;

        const actualData = await client.query("SELECT * FROM web.induccion_roadmap WHERE id = $1", [req.params.id]);
        if (actualData.rows.length === 0) {
            return res.status(404).json({ error: "Roadmap no encontrado" });
        }
        const actual = actualData.rows[0];

        const { tipo, items } = req.body;
        // Un roadmap ya publicado no vuelve a borrador.
        const publicar = req.body.estado === 'publicado' || actual.estado !== 'borrador';
        if (!TIPOS.includes(tipo)) {
            return res.status(400).json({ error: "Tipo de inducción inválido" });
        }
        const errorItems = validarItems(items, publicar ? 'publicado' : 'borrador');
        if (errorItems) {
            return res.status(400).json({ error: errorItems });
        }

        await client.query('BEGIN');
        await client.query(`
            UPDATE web.induccion_roadmap
            SET tipo = $1, sector = $2, planta = $3, fecha_ingreso = $4, jefe_directo = $5, tutor_rrhh = $6,
                info_util = $7,
                estado = CASE WHEN estado = 'borrador' AND $8::boolean THEN 'publicado' ELSE estado END,
                fecha_publicacion = CASE WHEN fecha_publicacion IS NULL AND $8::boolean THEN NOW() ELSE fecha_publicacion END,
                fecha_actualizacion = NOW()
            WHERE id = $9
        `, [...datosCabecera(req.body), publicar, actual.id]);
        await guardarItems(client, actual.id, items);
        await actualizarEstadoFinal(actual.id, client);
        await client.query('COMMIT');

        res.json({ roadmap: await obtenerRoadmapCompleto(actual.id) });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(err);
        res.status(500).json({ error: "Error actualizando el roadmap" });
    } finally {
        client.release();
    }
});

router.delete("/induccion/roadmaps/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const result = await pool.query("DELETE FROM web.induccion_roadmap WHERE id = $1 RETURNING id", [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Roadmap no encontrado" });
        }
        res.json({ ok: true });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando el roadmap" });
    }
});

// RRHH marca/desmarca una inducción como completada (registra fecha y usuario).
router.put("/induccion/items/:id/completada", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;

        const itemData = await pool.query(`
            SELECT i.id, i.roadmap_id, r.estado
            FROM web.induccion_roadmap_item i
            JOIN web.induccion_roadmap r ON r.id = i.roadmap_id
            WHERE i.id = $1
        `, [req.params.id]);
        if (itemData.rows.length === 0) {
            return res.status(404).json({ error: "Inducción no encontrada" });
        }
        const item = itemData.rows[0];
        if (item.estado === 'borrador') {
            return res.status(400).json({ error: "Publicá el roadmap antes de registrar inducciones completadas" });
        }

        const completada = !!req.body.completada;
        await pool.query(`
            UPDATE web.induccion_roadmap_item
            SET completada = $1,
                fecha_completada = CASE WHEN $1 THEN NOW() END,
                completada_por = CASE WHEN $1 THEN $2 END
            WHERE id = $3
        `, [completada, req.user.username, item.id]);
        await actualizarEstadoFinal(item.roadmap_id);

        res.json({ roadmap: await obtenerRoadmapCompleto(item.roadmap_id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando la inducción" });
    }
});

/* ================================ COLABORADOR (Perfil) ================================ */

async function obtenerRoadmapDelUsuario(username) {
    const usuario = await obtenerGerenciaDelUsuario(username);
    if (!usuario || !usuario.empleado_id) return null;
    const result = await pool.query(
        "SELECT id FROM web.induccion_roadmap WHERE empleado_id = $1 AND estado <> 'borrador'",
        [usuario.empleado_id]
    );
    if (result.rows.length === 0) return null;
    return obtenerRoadmapCompleto(result.rows[0].id);
}

router.get("/induccion/mi-induccion", requireAuth, async(req, res) => {
    try {
        const roadmap = await obtenerRoadmapDelUsuario(req.user.username);
        res.json({ roadmap });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo la inducción" });
    }
});

router.post("/induccion/mi-induccion/encuesta", requireAuth, async(req, res) => {
    try {
        const roadmap = await obtenerRoadmapDelUsuario(req.user.username);
        if (!roadmap) {
            return res.status(404).json({ error: "No tenés un roadmap de inducción publicado" });
        }
        if (roadmap.encuesta_completada) {
            return res.status(400).json({ error: "La encuesta ya fue completada" });
        }
        if (roadmap.items.some(i => !i.completada)) {
            return res.status(400).json({ error: "La encuesta se habilita al completar todas las inducciones" });
        }
        const puntaje = parseInt(req.body.puntaje, 10);
        if (!(puntaje >= 1 && puntaje <= 5)) {
            return res.status(400).json({ error: "El puntaje debe estar entre 1 y 5" });
        }

        await pool.query(`
            UPDATE web.induccion_roadmap
            SET encuesta_completada = true, encuesta_respuestas = $1, encuesta_fecha = NOW()
            WHERE id = $2
        `, [JSON.stringify({ puntaje, comentarios: req.body.comentarios || '' }), roadmap.id]);
        await actualizarEstadoFinal(roadmap.id);

        res.json({ roadmap: await obtenerRoadmapCompleto(roadmap.id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error guardando la encuesta" });
    }
});

module.exports = router;
