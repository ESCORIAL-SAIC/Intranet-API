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
   proceso. Cada inducción puede tener asignada una evaluación de Forms (RRHH la marca como
   realizada) y, a los 30 días del ingreso, se habilita la encuesta de 1.er mes (Forms; la
   marca el colaborador o RRHH). Esquema en RRHH_INDUCCION_DDL.sql (+ _V2_DDL.sql). */

const GRUPO_RRHH = "'rrhh'";

const TIPOS = ['estandar', 'jefatura'];

// Evaluaciones de Forms asignables a una inducción (una por inducción). Los links están en el
// frontend (RRHHInduccion/constants.js -> EVALUACIONES); acá solo se validan los códigos.
const EVALUACIONES = ['rrhh', 'ssma', 'calidad'];

// La encuesta de 1.er mes se habilita a estos días de la fecha de ingreso.
const DIAS_ENCUESTA_1MES = 30;

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

// Fechas como texto 'YYYY-MM-DD' en hora local del servidor (las de la base llegan así vía TO_CHAR).
function fechaISO(fecha) {
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function sumarDias(fecha, dias) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return fechaISO(new Date(anio, mes - 1, dia + dias));
}

function ordenCronologico(a, b) {
    const claveA = a.fecha ? `${a.fecha} ${a.horario || '99:99'}` : null;
    const claveB = b.fecha ? `${b.fecha} ${b.horario || '99:99'}` : null;
    if (claveA && claveB && claveA !== claveB) return claveA < claveB ? -1 : 1;
    if (claveA && !claveB) return -1;
    if (!claveA && claveB) return 1;
    return a.orden - b.orden;
}

// Progreso: inducciones + evaluaciones asignadas + encuesta de satisfacción (todo lo que hace
// falta para finalizar). La encuesta de 1.er mes se sigue aparte: llega después de finalizar.
function calcularProgreso(items, encuestaCompletada) {
    const conEvaluacion = items.filter(i => i.evaluacion_tipo);
    const total = items.length + conEvaluacion.length + 1;
    const completadas = items.filter(i => i.completada).length
        + conEvaluacion.filter(i => i.evaluacion_completada).length
        + (encuestaCompletada ? 1 : 0);
    return { total, completadas, porcentaje: Math.round((completadas / total) * 100) };
}

function estadoEncuesta1Mes(roadmap) {
    const base = roadmap.fecha_ingreso || (roadmap.fecha_publicacion ? fechaISO(new Date(roadmap.fecha_publicacion)) : null);
    const disponibleDesde = base ? sumarDias(base, DIAS_ENCUESTA_1MES) : null;
    let estado = 'no_corresponde';
    if (roadmap.encuesta_1mes_completada) estado = 'completada';
    else if (roadmap.estado !== 'borrador' && disponibleDesde && fechaISO(new Date()) >= disponibleDesde) estado = 'pendiente';
    return { estado, disponible_desde: disponibleDesde, fecha: roadmap.encuesta_1mes_fecha };
}

// Datos derivados para el seguimiento de RRHH (indicadores y columnas del tablero) y el Perfil.
function resumirRoadmap(roadmap, items) {
    const hoy = fechaISO(new Date());
    const ordenados = [...items].sort(ordenCronologico);
    const pendientes = ordenados.filter(i => !i.completada);
    const evaluacionesPendientes = ordenados.filter(i => i.completada && i.evaluacion_tipo && !i.evaluacion_completada);
    const atrasadas = pendientes.filter(i => i.fecha && i.fecha < hoy);

    let proximoPendiente = null;
    if (roadmap.estado !== 'borrador') {
        if (pendientes.length > 0) {
            const i = pendientes[0];
            proximoPendiente = { tipo: 'induccion', nombre: i.nombre, fecha: i.fecha, horario: i.horario, atrasada: !!(i.fecha && i.fecha < hoy) };
        } else if (evaluacionesPendientes.length > 0) {
            const i = evaluacionesPendientes[0];
            proximoPendiente = { tipo: 'evaluacion', nombre: i.nombre, evaluacion_tipo: i.evaluacion_tipo };
        } else if (!roadmap.encuesta_completada) {
            proximoPendiente = { tipo: 'encuesta', nombre: 'Encuesta de satisfacción' };
        }
    }

    return {
        progreso: calcularProgreso(items, roadmap.encuesta_completada),
        proximo_pendiente: proximoPendiente,
        actividades_atrasadas: atrasadas.length,
        evaluaciones_pendientes: evaluacionesPendientes.length,
        encuesta_1mes: estadoEncuesta1Mes(roadmap),
    };
}

async function obtenerItems(roadmapId, client = pool) {
    const result = await client.query(
        `SELECT id, roadmap_id, catalogo_id, orden, nombre,
                TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, TO_CHAR(horario, 'HH24:MI') AS horario,
                duracion_min, ubicacion, facilitador, material_url,
                evaluacion_tipo, evaluacion_completada, evaluacion_fecha, evaluacion_marcada_por,
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
    return { ...roadmap, items, ...resumirRoadmap(roadmap, items) };
}

// Pasa a 'finalizado' cuando todo está completo (inducciones, evaluaciones asignadas y encuesta
// de satisfacción) y vuelve a 'publicado' si RRHH desmarca algo. Un borrador no cambia acá.
async function actualizarEstadoFinal(roadmapId, client = pool) {
    await client.query(`
        WITH calc AS (
            SELECT r.id,
                   CASE WHEN r.encuesta_completada AND NOT EXISTS (
                            SELECT 1 FROM web.induccion_roadmap_item i
                            WHERE i.roadmap_id = r.id
                              AND (NOT i.completada OR (i.evaluacion_tipo IS NOT NULL AND NOT i.evaluacion_completada))
                        ) THEN 'finalizado'
                        ELSE 'publicado'
                   END AS nuevo_estado
            FROM web.induccion_roadmap r
            WHERE r.id = $1 AND r.estado <> 'borrador'
        )
        UPDATE web.induccion_roadmap r
        SET estado = calc.nuevo_estado,
            fecha_finalizacion = CASE WHEN calc.nuevo_estado = 'finalizado' THEN COALESCE(r.fecha_finalizacion, NOW()) END
        FROM calc
        WHERE r.id = calc.id
    `, [roadmapId]);
}

// Inducción + estado de su roadmap, para los endpoints que marcan una actividad.
async function obtenerItemConRoadmap(itemId) {
    const result = await pool.query(`
        SELECT i.id, i.roadmap_id, i.evaluacion_tipo, r.estado
        FROM web.induccion_roadmap_item i
        JOIN web.induccion_roadmap r ON r.id = i.roadmap_id
        WHERE i.id = $1
    `, [itemId]);
    return result.rows[0] || null;
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
        if (item.evaluacion_tipo && !EVALUACIONES.includes(item.evaluacion_tipo)) {
            return `Evaluación inválida en la inducción "${item.nombre}"`;
        }
    }
    return null;
}

// Inserta o actualiza los items enviados (en el orden recibido) y elimina los que ya no
// están. Los items existentes conservan su estado de completada; la evaluación vuelve a
// pendiente si RRHH le cambia el tipo.
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
            item.evaluacion_tipo || null,
            item.observaciones || null,
        ];
        if (item.id && idsExistentes.has(item.id)) {
            await client.query(`
                UPDATE web.induccion_roadmap_item
                SET orden = $1, nombre = $2, fecha = $3, horario = $4, duracion_min = $5, ubicacion = $6,
                    facilitador = $7, material_url = $8, observaciones = $10,
                    evaluacion_completada  = CASE WHEN evaluacion_tipo IS NOT DISTINCT FROM $9::varchar THEN evaluacion_completada ELSE false END,
                    evaluacion_fecha       = CASE WHEN evaluacion_tipo IS NOT DISTINCT FROM $9::varchar THEN evaluacion_fecha END,
                    evaluacion_marcada_por = CASE WHEN evaluacion_tipo IS NOT DISTINCT FROM $9::varchar THEN evaluacion_marcada_por END,
                    evaluacion_tipo = $9::varchar
                WHERE id = $11 AND roadmap_id = $12
            `, [...valores, item.id, roadmapId]);
        } else {
            await client.query(`
                INSERT INTO web.induccion_roadmap_item
                    (id, roadmap_id, catalogo_id, orden, nombre, fecha, horario, duracion_min, ubicacion,
                     facilitador, material_url, evaluacion_tipo, observaciones)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        const roadmapsData = await pool.query(`
            SELECT
                r.id, r.empleado_id, r.tipo, r.nombre_snapshot, r.legajo_snapshot, r.puesto_snapshot,
                r.sector, r.planta, TO_CHAR(r.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, r.tutor_rrhh,
                r.estado, r.encuesta_completada, r.encuesta_1mes_completada, r.encuesta_1mes_fecha,
                r.fecha_publicacion, r.fecha_finalizacion, r.fecha_creacion
            FROM web.induccion_roadmap r
            ORDER BY r.fecha_creacion DESC
        `);
        const itemsData = await pool.query(`
            SELECT roadmap_id, orden, nombre,
                   TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, TO_CHAR(horario, 'HH24:MI') AS horario,
                   completada, evaluacion_tipo, evaluacion_completada
            FROM web.induccion_roadmap_item
        `);
        const itemsPorRoadmap = {};
        for (const item of itemsData.rows) {
            (itemsPorRoadmap[item.roadmap_id] = itemsPorRoadmap[item.roadmap_id] || []).push(item);
        }
        const roadmaps = roadmapsData.rows.map(r => ({ ...r, ...resumirRoadmap(r, itemsPorRoadmap[r.id] || []) }));
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

        const item = await obtenerItemConRoadmap(req.params.id);
        if (!item) {
            return res.status(404).json({ error: "Inducción no encontrada" });
        }
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

// RRHH marca/desmarca como realizada la evaluación (Forms) asignada a una inducción.
router.put("/induccion/items/:id/evaluacion", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;

        const item = await obtenerItemConRoadmap(req.params.id);
        if (!item) {
            return res.status(404).json({ error: "Inducción no encontrada" });
        }
        if (!item.evaluacion_tipo) {
            return res.status(400).json({ error: "La inducción no tiene una evaluación asignada" });
        }
        if (item.estado === 'borrador') {
            return res.status(400).json({ error: "Publicá el roadmap antes de registrar evaluaciones" });
        }

        const completada = !!req.body.completada;
        await pool.query(`
            UPDATE web.induccion_roadmap_item
            SET evaluacion_completada = $1,
                evaluacion_fecha = CASE WHEN $1 THEN NOW() END,
                evaluacion_marcada_por = CASE WHEN $1 THEN $2 END
            WHERE id = $3
        `, [completada, req.user.username, item.id]);
        await actualizarEstadoFinal(item.roadmap_id);

        res.json({ roadmap: await obtenerRoadmapCompleto(item.roadmap_id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando la evaluación" });
    }
});

async function marcarEncuesta1Mes(roadmapId, completada, username) {
    await pool.query(`
        UPDATE web.induccion_roadmap
        SET encuesta_1mes_completada = $1,
            encuesta_1mes_fecha = CASE WHEN $1 THEN NOW() END,
            encuesta_1mes_marcada_por = CASE WHEN $1 THEN $2 END
        WHERE id = $3
    `, [completada, username, roadmapId]);
}

// RRHH marca/desmarca la encuesta de 1.er mes (Forms externo) como respondida.
router.put("/induccion/roadmaps/:id/encuesta-1mes", requireAuth, async(req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;

        const roadmap = await obtenerRoadmapCompleto(req.params.id);
        if (!roadmap) {
            return res.status(404).json({ error: "Roadmap no encontrado" });
        }
        if (roadmap.estado === 'borrador') {
            return res.status(400).json({ error: "Publicá el roadmap antes de registrar la encuesta de 1.er mes" });
        }

        await marcarEncuesta1Mes(roadmap.id, !!req.body.completada, req.user.username);
        res.json({ roadmap: await obtenerRoadmapCompleto(roadmap.id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando la encuesta de 1.er mes" });
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

// El colaborador indica que ya respondió la encuesta de 1.er mes (Forms externo).
router.post("/induccion/mi-induccion/encuesta-1mes", requireAuth, async(req, res) => {
    try {
        const roadmap = await obtenerRoadmapDelUsuario(req.user.username);
        if (!roadmap) {
            return res.status(404).json({ error: "No tenés un roadmap de inducción publicado" });
        }
        if (roadmap.encuesta_1mes.estado !== 'pendiente') {
            return res.status(400).json({ error: "La encuesta de 1.er mes no está disponible" });
        }

        await marcarEncuesta1Mes(roadmap.id, true, req.user.username);
        res.json({ roadmap: await obtenerRoadmapCompleto(roadmap.id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error guardando la encuesta de 1.er mes" });
    }
});

module.exports = router;
