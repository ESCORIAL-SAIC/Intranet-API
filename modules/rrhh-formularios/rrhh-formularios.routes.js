const express = require("express");
const crypto = require("crypto");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { perteneceGrupo } = require("../../shared/grupos");
const { obtenerGerenciaDelUsuario, obtenerReportesDirectos } = require("../../shared/organigrama");

const router = express.Router();

/* RRHH FORMULARIOS — Riesgo e Impacto de Pérdida / Guía de Potencial
   RRHH/Dirección/administradores abren un "ciclo" (ventana de fechas, independiente por
   tipo de formulario). Mientras el ciclo está vigente, cualquier líder ve y completa el
   formulario de cada uno de sus reportes directos (1 solo nivel jerárquico). RRHH conserva
   acceso total (alta manual, edición, listado cross-org) para casos excepcionales. El
   colaborador evaluado nunca tiene acceso a estos registros (ver nota de confidencialidad
   en los maquetados de referencia). */

const GRUPO_ADMIN = "'Direccion','administradores','rrhh'";

const TIPOS_FORMULARIO = {
    'riesgo-impacto': { dbTipo: 'riesgo_impacto', tabla: 'formulario_riesgo_impacto' },
    'guia-potencial': { dbTipo: 'guia_potencial', tabla: 'formulario_guia_potencial' },
};

async function esAdminRRHH(username) {
    return perteneceGrupo({ username, grupousuario: GRUPO_ADMIN });
}

async function requireAdminRRHH(req, res) {
    const ok = await esAdminRRHH(req.user.username);
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para Dirección/administradores/RRHH" });
        return false;
    }
    return true;
}

function resolverTipo(req, res) {
    const info = TIPOS_FORMULARIO[req.params.tipo];
    if (!info) {
        res.status(400).json({ error: "Tipo de formulario inválido" });
        return null;
    }
    return info;
}

async function obtenerPuestoSnapshot(empleadoId) {
    const empleadoData = await pool.query(`
        SELECT puesto.nombre AS puesto
        FROM empleado emp
        LEFT JOIN ud_empleado ude ON ude.id = emp.boextension_id
        LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
        WHERE emp.id = $1
    `, [empleadoId]);
    return empleadoData.rows[0] ? empleadoData.rows[0].puesto : null;
}

async function obtenerCicloVigente(dbTipo) {
    const result = await pool.query(
        "SELECT * FROM web.ciclo_formulario_rrhh WHERE tipo = $1 AND CURRENT_DATE BETWEEN fecha_desde AND fecha_hasta ORDER BY fecha_creacion DESC LIMIT 1",
        [dbTipo]
    );
    return result.rows[0] || null;
}

async function cicloVigentePorId(cicloId) {
    const result = await pool.query(
        "SELECT 1 FROM web.ciclo_formulario_rrhh WHERE id = $1 AND CURRENT_DATE BETWEEN fecha_desde AND fecha_hasta",
        [cicloId]
    );
    return result.rows.length > 0;
}

// Un líder puede editar/eliminar mientras el registro esté en borrador, el ciclo siga
// vigente y sea el propio creador. RRHH/admin siempre puede.
async function puedeEditarRegistro(registro, username, esAdmin) {
    if (esAdmin) return true;
    if (registro.creado_por !== username) return false;
    if (registro.estado !== 'borrador') return false;
    return cicloVigentePorId(registro.ciclo_id);
}

/* Debe reflejar exactamente components/Modules/RRHHFormularios/constants.js en el frontend */
const RIESGO_CODES = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];
const IMPACTO_CODES = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'];
const DIMENSION_CODES = ['agilidad_aprendizaje', 'ambicion_proyeccion', 'influencia_emergente'];

function respuestasCompletas(respuestas, codes) {
    return codes.every(c => respuestas && typeof respuestas[c] === 'string' && respuestas[c].length > 0);
}

function dimensionesCompletas(dimensiones) {
    return DIMENSION_CODES.every(c => dimensiones && dimensiones[c] && ['bajo', 'medio', 'alto'].includes(dimensiones[c].rating));
}

/* ===================================== CICLOS ===================================== */

router.get("/rrhh-formularios/ciclos/:tipo", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const info = resolverTipo(req, res);
        if (!info) return;
        const ciclos = await pool.query(
            "SELECT * FROM web.ciclo_formulario_rrhh WHERE tipo = $1 ORDER BY fecha_desde DESC",
            [info.dbTipo]
        );
        res.json({ ciclos: ciclos.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los ciclos" });
    }
});

router.post("/rrhh-formularios/ciclos/:tipo", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const info = resolverTipo(req, res);
        if (!info) return;

        const { nombre, fecha_desde, fecha_hasta } = req.body;
        if (!fecha_desde || !fecha_hasta) {
            return res.status(400).json({ error: "fecha_desde y fecha_hasta son requeridas" });
        }
        if (new Date(fecha_hasta) < new Date(fecha_desde)) {
            return res.status(400).json({ error: "fecha_hasta no puede ser anterior a fecha_desde" });
        }

        const solapado = await pool.query(
            "SELECT 1 FROM web.ciclo_formulario_rrhh WHERE tipo = $1 AND fecha_desde <= $3 AND fecha_hasta >= $2",
            [info.dbTipo, fecha_desde, fecha_hasta]
        );
        if (solapado.rows.length > 0) {
            return res.status(409).json({ error: "Ya existe un ciclo de este tipo que se superpone con esas fechas" });
        }

        const cicloId = crypto.randomUUID();
        const result = await pool.query(
            `INSERT INTO web.ciclo_formulario_rrhh (id, tipo, nombre, fecha_desde, fecha_hasta, creado_por, fecha_creacion)
             VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
            [cicloId, info.dbTipo, nombre || null, fecha_desde, fecha_hasta, req.user.username]
        );
        res.status(201).json({ ciclo: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando el ciclo" });
    }
});

router.put("/rrhh-formularios/ciclos/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;

        const cicloData = await pool.query("SELECT * FROM web.ciclo_formulario_rrhh WHERE id = $1", [req.params.id]);
        if (cicloData.rows.length === 0) {
            return res.status(404).json({ error: "Ciclo no encontrado" });
        }
        const ciclo = cicloData.rows[0];
        const { nombre, fecha_desde, fecha_hasta } = req.body;
        const nuevaDesde = fecha_desde || ciclo.fecha_desde;
        const nuevaHasta = fecha_hasta || ciclo.fecha_hasta;

        if (new Date(nuevaHasta) < new Date(nuevaDesde)) {
            return res.status(400).json({ error: "fecha_hasta no puede ser anterior a fecha_desde" });
        }

        const solapado = await pool.query(
            "SELECT 1 FROM web.ciclo_formulario_rrhh WHERE tipo = $1 AND id <> $2 AND fecha_desde <= $4 AND fecha_hasta >= $3",
            [ciclo.tipo, ciclo.id, nuevaDesde, nuevaHasta]
        );
        if (solapado.rows.length > 0) {
            return res.status(409).json({ error: "Ya existe un ciclo de este tipo que se superpone con esas fechas" });
        }

        const result = await pool.query(
            "UPDATE web.ciclo_formulario_rrhh SET nombre = COALESCE($1, nombre), fecha_desde = $2, fecha_hasta = $3 WHERE id = $4 RETURNING *",
            [nombre || null, nuevaDesde, nuevaHasta, ciclo.id]
        );
        res.json({ ciclo: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando el ciclo" });
    }
});

router.delete("/rrhh-formularios/ciclos/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;

        const cicloData = await pool.query("SELECT * FROM web.ciclo_formulario_rrhh WHERE id = $1", [req.params.id]);
        if (cicloData.rows.length === 0) {
            return res.status(404).json({ error: "Ciclo no encontrado" });
        }
        const ciclo = cicloData.rows[0];
        const tabla = ciclo.tipo === 'riesgo_impacto' ? 'formulario_riesgo_impacto' : 'formulario_guia_potencial';

        const usados = await pool.query(`SELECT 1 FROM web.${tabla} WHERE ciclo_id = $1 LIMIT 1`, [ciclo.id]);
        if (usados.rows.length > 0) {
            return res.status(400).json({ error: "No se puede eliminar: ya hay formularios cargados en este ciclo" });
        }

        await pool.query("DELETE FROM web.ciclo_formulario_rrhh WHERE id = $1", [ciclo.id]);
        res.json({ success: true });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando el ciclo" });
    }
});

/* ============================== PENDIENTES / INICIAR ============================== */

router.get("/rrhh-formularios/pendientes/:tipo", requireAuth, async(req, res) => {
    try {
        const info = resolverTipo(req, res);
        if (!info) return;
        const username = req.user.username;

        const reportes = await obtenerReportesDirectos(username);
        const ciclo = await obtenerCicloVigente(info.dbTipo);

        if (!ciclo || reportes.length === 0) {
            return res.json({ ciclo: ciclo || null, items: [] });
        }

        const empleadoIds = reportes.map(r => r.id);
        const placeholders = empleadoIds.map((_, i) => `$${i + 2}`).join(',');
        const existentes = await pool.query(
            `SELECT id, empleado_id, estado FROM web.${info.tabla} WHERE ciclo_id = $1 AND empleado_id IN (${placeholders})`,
            [ciclo.id, ...empleadoIds]
        );
        const porEmpleado = new Map(existentes.rows.map(r => [r.empleado_id, r]));

        const items = reportes.map(r => {
            const existente = porEmpleado.get(r.id);
            return {
                empleado_id: r.id,
                empleado_nombre: r.nombre,
                puesto: r.puesto,
                registro_id: existente ? existente.id : null,
                estado: existente ? existente.estado : 'pendiente',
            };
        });

        res.json({ ciclo, items });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo pendientes" });
    }
});

router.post("/rrhh-formularios/iniciar/:tipo", requireAuth, async(req, res) => {
    try {
        const info = resolverTipo(req, res);
        if (!info) return;
        const username = req.user.username;
        const { empleado_id } = req.body;

        if (!empleado_id) {
            return res.status(400).json({ error: "empleado_id es requerido" });
        }

        const reportes = await obtenerReportesDirectos(username);
        if (!reportes.some(r => r.id === empleado_id)) {
            return res.status(403).json({ error: "Ese empleado no es un reporte directo tuyo" });
        }

        const ciclo = await obtenerCicloVigente(info.dbTipo);
        if (!ciclo) {
            return res.status(400).json({ error: "No hay un ciclo abierto para este formulario" });
        }

        const existente = await pool.query(
            `SELECT * FROM web.${info.tabla} WHERE empleado_id = $1 AND ciclo_id = $2`,
            [empleado_id, ciclo.id]
        );
        if (existente.rows.length > 0) {
            return res.json({ registro: existente.rows[0] });
        }

        const infoLider = await obtenerGerenciaDelUsuario(username);
        const puestoSnapshot = await obtenerPuestoSnapshot(empleado_id);
        const registroId = crypto.randomUUID();
        const anio = new Date(ciclo.fecha_desde).getFullYear();
        const evaluador = infoLider ? infoLider.empleado_nombre : null;

        let insertResult;
        try {
            insertResult = await pool.query(
                `INSERT INTO web.${info.tabla}
                 (id, ciclo_id, empleado_id, anio, puesto_snapshot, evaluador, estado, creado_por, fecha_creacion)
                 VALUES ($1, $2, $3, $4, $5, $6, 'borrador', $7, NOW()) RETURNING *`,
                [registroId, ciclo.id, empleado_id, anio, puestoSnapshot, evaluador, username]
            );
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: "Ya existe un registro para ese empleado en este ciclo" });
            }
            throw err;
        }

        res.status(201).json({ registro: insertResult.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error iniciando el registro" });
    }
});

/* ============================= RIESGO E IMPACTO DE PÉRDIDA ============================= */

const RIESGO_IMPACTO_SELECT = `
    SELECT
        r.*,
        pers.nombre AS empleado_nombre,
        s.nombre AS area,
        g.nombre AS gerencia,
        c.nombre AS ciclo_nombre,
        c.fecha_desde AS ciclo_fecha_desde,
        c.fecha_hasta AS ciclo_fecha_hasta
    FROM web.formulario_riesgo_impacto r
    LEFT JOIN empleado emp ON emp.id = r.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
    LEFT JOIN web.ciclo_formulario_rrhh c ON c.id = r.ciclo_id
`;

router.get("/rrhh-formularios/riesgo-impacto", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const allDatas = await pool.query(`${RIESGO_IMPACTO_SELECT} ORDER BY r.fecha_creacion DESC`);
        res.json({ registros: allDatas.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los registros de Riesgo e Impacto de Pérdida" });
    }
});

router.get("/rrhh-formularios/riesgo-impacto/:id", requireAuth, async(req, res) => {
    try {
        const registroData = await pool.query(`${RIESGO_IMPACTO_SELECT} WHERE r.id = $1`, [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];
        const username = req.user.username;
        const esAdmin = await esAdminRRHH(username);

        if (!esAdmin && registro.creado_por !== username) {
            return res.status(403).json({ error: "No tenés acceso a este registro" });
        }

        res.json({ registro, puede_editar: await puedeEditarRegistro(registro, username, esAdmin) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el registro" });
    }
});

router.put("/rrhh-formularios/riesgo-impacto/:id", requireAuth, async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;
        const esAdmin = await esAdminRRHH(username);

        const registroData = await pool.query("SELECT * FROM web.formulario_riesgo_impacto WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        if (!(await puedeEditarRegistro(registro, username, esAdmin))) {
            return res.status(403).json({ error: "No tenés permiso para editar este registro" });
        }

        const { evaluador, antiguedad, fecha, respuestas_riesgo, contexto_riesgo, respuestas_impacto, contexto_impacto, estado } = req.body;

        if (registro.estado === 'finalizado' && estado !== 'borrador') {
            return res.status(400).json({ error: "El registro ya está finalizado" });
        }

        const nuevasRespuestasRiesgo = respuestas_riesgo !== undefined ? respuestas_riesgo : registro.respuestas_riesgo;
        const nuevasRespuestasImpacto = respuestas_impacto !== undefined ? respuestas_impacto : registro.respuestas_impacto;

        if (estado === 'finalizado') {
            if (!respuestasCompletas(nuevasRespuestasRiesgo, RIESGO_CODES) || !respuestasCompletas(nuevasRespuestasImpacto, IMPACTO_CODES)) {
                return res.status(400).json({ error: "Faltan preguntas por responder antes de finalizar" });
            }
        }

        const result = await pool.query(
            `UPDATE web.formulario_riesgo_impacto
             SET evaluador = COALESCE($1, evaluador),
                 antiguedad = COALESCE($2, antiguedad),
                 fecha = COALESCE($3, fecha),
                 respuestas_riesgo = $4,
                 contexto_riesgo = COALESCE($5, contexto_riesgo),
                 respuestas_impacto = $6,
                 contexto_impacto = COALESCE($7, contexto_impacto),
                 estado = COALESCE($8, estado),
                 fecha_actualizacion = NOW()
             WHERE id = $9 RETURNING *`,
            [
                evaluador || null, antiguedad || null, fecha || null,
                JSON.stringify(nuevasRespuestasRiesgo), contexto_riesgo ?? null,
                JSON.stringify(nuevasRespuestasImpacto), contexto_impacto ?? null,
                estado || null, registroId
            ]
        );

        res.json({ registro: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando el registro" });
    }
});

router.delete("/rrhh-formularios/riesgo-impacto/:id", requireAuth, async(req, res) => {
    try {
        const username = req.user.username;
        const esAdmin = await esAdminRRHH(username);

        const registroData = await pool.query("SELECT * FROM web.formulario_riesgo_impacto WHERE id = $1", [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        if (!(await puedeEditarRegistro(registro, username, esAdmin))) {
            return res.status(403).json({ error: "No tenés permiso para eliminar este registro" });
        }
        if (registro.estado !== 'borrador') {
            return res.status(400).json({ error: "Sólo se pueden eliminar registros en borrador" });
        }

        await pool.query("DELETE FROM web.formulario_riesgo_impacto WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando el registro" });
    }
});

/* ================================== GUÍA DE POTENCIAL ================================== */

const GUIA_POTENCIAL_SELECT = `
    SELECT
        r.*,
        pers.nombre AS empleado_nombre,
        s.nombre AS area,
        g.nombre AS gerencia,
        c.nombre AS ciclo_nombre,
        c.fecha_desde AS ciclo_fecha_desde,
        c.fecha_hasta AS ciclo_fecha_hasta
    FROM web.formulario_guia_potencial r
    LEFT JOIN empleado emp ON emp.id = r.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
    LEFT JOIN web.ciclo_formulario_rrhh c ON c.id = r.ciclo_id
`;

router.get("/rrhh-formularios/guia-potencial", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const allDatas = await pool.query(`${GUIA_POTENCIAL_SELECT} ORDER BY r.fecha_creacion DESC`);
        res.json({ registros: allDatas.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los registros de Guía de Potencial" });
    }
});

router.get("/rrhh-formularios/guia-potencial/:id", requireAuth, async(req, res) => {
    try {
        const registroData = await pool.query(`${GUIA_POTENCIAL_SELECT} WHERE r.id = $1`, [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];
        const username = req.user.username;
        const esAdmin = await esAdminRRHH(username);

        if (!esAdmin && registro.creado_por !== username) {
            return res.status(403).json({ error: "No tenés acceso a este registro" });
        }

        res.json({ registro, puede_editar: await puedeEditarRegistro(registro, username, esAdmin) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el registro" });
    }
});

router.put("/rrhh-formularios/guia-potencial/:id", requireAuth, async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;
        const esAdmin = await esAdminRRHH(username);

        const registroData = await pool.query("SELECT * FROM web.formulario_guia_potencial WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        if (!(await puedeEditarRegistro(registro, username, esAdmin))) {
            return res.status(403).json({ error: "No tenés permiso para editar este registro" });
        }

        const { evaluador, antiguedad_rol, fecha, fit_score, perfil_predominante, dimensiones, potencial_global, proyeccion_rol, observaciones, estado } = req.body;

        if (registro.estado === 'finalizado' && estado !== 'borrador') {
            return res.status(400).json({ error: "El registro ya está finalizado" });
        }

        const nuevasDimensiones = dimensiones !== undefined ? dimensiones : registro.dimensiones;
        const nuevoPotencialGlobal = potencial_global !== undefined ? potencial_global : registro.potencial_global;

        if (estado === 'finalizado') {
            if (!dimensionesCompletas(nuevasDimensiones) || !nuevoPotencialGlobal) {
                return res.status(400).json({ error: "Faltan dimensiones o el potencial global por completar antes de finalizar" });
            }
        }

        const result = await pool.query(
            `UPDATE web.formulario_guia_potencial
             SET evaluador = COALESCE($1, evaluador),
                 antiguedad_rol = COALESCE($2, antiguedad_rol),
                 fecha = COALESCE($3, fecha),
                 fit_score = COALESCE($4, fit_score),
                 perfil_predominante = COALESCE($5, perfil_predominante),
                 dimensiones = $6,
                 potencial_global = COALESCE($7, potencial_global),
                 proyeccion_rol = COALESCE($8, proyeccion_rol),
                 observaciones = COALESCE($9, observaciones),
                 estado = COALESCE($10, estado),
                 fecha_actualizacion = NOW()
             WHERE id = $11 RETURNING *`,
            [
                evaluador || null, antiguedad_rol || null, fecha || null, fit_score ?? null, perfil_predominante || null,
                JSON.stringify(nuevasDimensiones), potencial_global || null, proyeccion_rol || null, observaciones || null,
                estado || null, registroId
            ]
        );

        res.json({ registro: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando el registro" });
    }
});

router.delete("/rrhh-formularios/guia-potencial/:id", requireAuth, async(req, res) => {
    try {
        const username = req.user.username;
        const esAdmin = await esAdminRRHH(username);

        const registroData = await pool.query("SELECT * FROM web.formulario_guia_potencial WHERE id = $1", [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        if (!(await puedeEditarRegistro(registro, username, esAdmin))) {
            return res.status(403).json({ error: "No tenés permiso para eliminar este registro" });
        }
        if (registro.estado !== 'borrador') {
            return res.status(400).json({ error: "Sólo se pueden eliminar registros en borrador" });
        }

        await pool.query("DELETE FROM web.formulario_guia_potencial WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando el registro" });
    }
});

module.exports = router;
