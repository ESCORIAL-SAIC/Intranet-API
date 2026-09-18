const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { perteneceGrupo } = require("../../shared/grupos");

const router = express.Router();

/* RRHH FORMULARIOS — Riesgo e Impacto de Pérdida / Guía de Potencial
   Acceso exclusivo Dirección/administradores/RRHH. A diferencia de Objetivos Anuales,
   el colaborador evaluado nunca tiene acceso a estos registros (ver nota de
   confidencialidad en los maquetados de referencia). */

const GRUPO_ADMIN = "'Direccion','administradores','rrhh'";

async function requireAdminRRHH(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: GRUPO_ADMIN });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para Dirección/administradores/RRHH" });
        return false;
    }
    return true;
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

/* ============================= RIESGO E IMPACTO DE PÉRDIDA ============================= */

const RIESGO_IMPACTO_SELECT = `
    SELECT
        r.*,
        pers.nombre AS empleado_nombre,
        s.nombre AS area,
        g.nombre AS gerencia
    FROM web.formulario_riesgo_impacto r
    LEFT JOIN empleado emp ON emp.id = r.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
`;

router.get("/rrhh-formularios/riesgo-impacto", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const allDatas = await pool.query(`${RIESGO_IMPACTO_SELECT} ORDER BY r.anio DESC, pers.nombre ASC`);
        res.json({ registros: allDatas.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los registros de Riesgo e Impacto de Pérdida" });
    }
});

router.get("/rrhh-formularios/riesgo-impacto/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const registroData = await pool.query(`${RIESGO_IMPACTO_SELECT} WHERE r.id = $1`, [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        res.json({ registro: registroData.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el registro" });
    }
});

router.post("/rrhh-formularios/riesgo-impacto", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;

        const { empleado_id, anio, evaluador, antiguedad, fecha, respuestas_riesgo, contexto_riesgo, respuestas_impacto, contexto_impacto } = req.body;
        const username = req.user.username;

        if (!empleado_id || !anio) {
            return res.status(400).json({ error: "empleado_id y anio son requeridos" });
        }

        const puestoSnapshot = await obtenerPuestoSnapshot(empleado_id);
        const registroId = require('crypto').randomUUID();

        let registroResult;
        try {
            registroResult = await pool.query(
                `INSERT INTO web.formulario_riesgo_impacto
                 (id, empleado_id, anio, puesto_snapshot, evaluador, antiguedad, fecha,
                  respuestas_riesgo, contexto_riesgo, respuestas_impacto, contexto_impacto, estado, creado_por, fecha_creacion)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'borrador', $12, NOW()) RETURNING *`,
                [
                    registroId, empleado_id, anio, puestoSnapshot, evaluador || null, antiguedad || null, fecha || null,
                    JSON.stringify(respuestas_riesgo || {}), contexto_riesgo || null,
                    JSON.stringify(respuestas_impacto || {}), contexto_impacto || null, username
                ]
            );
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: "Ya existe un registro de Riesgo e Impacto de Pérdida para ese empleado en ese año" });
            }
            throw err;
        }

        res.status(201).json({ registro: registroResult.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando el registro de Riesgo e Impacto de Pérdida" });
    }
});

router.put("/rrhh-formularios/riesgo-impacto/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;

        const registroId = req.params.id;
        const { evaluador, antiguedad, fecha, respuestas_riesgo, contexto_riesgo, respuestas_impacto, contexto_impacto, estado } = req.body;

        const registroData = await pool.query("SELECT * FROM web.formulario_riesgo_impacto WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

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
        if (!(await requireAdminRRHH(req, res))) return;

        const registroData = await pool.query("SELECT * FROM web.formulario_riesgo_impacto WHERE id = $1", [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        if (registroData.rows[0].estado !== 'borrador') {
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
        g.nombre AS gerencia
    FROM web.formulario_guia_potencial r
    LEFT JOIN empleado emp ON emp.id = r.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
`;

router.get("/rrhh-formularios/guia-potencial", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const allDatas = await pool.query(`${GUIA_POTENCIAL_SELECT} ORDER BY r.anio DESC, pers.nombre ASC`);
        res.json({ registros: allDatas.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los registros de Guía de Potencial" });
    }
});

router.get("/rrhh-formularios/guia-potencial/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;
        const registroData = await pool.query(`${GUIA_POTENCIAL_SELECT} WHERE r.id = $1`, [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        res.json({ registro: registroData.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el registro" });
    }
});

router.post("/rrhh-formularios/guia-potencial", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;

        const { empleado_id, anio, evaluador, antiguedad_rol, fecha, fit_score, perfil_predominante, dimensiones, potencial_global, proyeccion_rol, observaciones } = req.body;
        const username = req.user.username;

        if (!empleado_id || !anio) {
            return res.status(400).json({ error: "empleado_id y anio son requeridos" });
        }

        const puestoSnapshot = await obtenerPuestoSnapshot(empleado_id);
        const registroId = require('crypto').randomUUID();

        let registroResult;
        try {
            registroResult = await pool.query(
                `INSERT INTO web.formulario_guia_potencial
                 (id, empleado_id, anio, puesto_snapshot, evaluador, antiguedad_rol, fecha, fit_score, perfil_predominante,
                  dimensiones, potencial_global, proyeccion_rol, observaciones, estado, creado_por, fecha_creacion)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'borrador', $14, NOW()) RETURNING *`,
                [
                    registroId, empleado_id, anio, puestoSnapshot, evaluador || null, antiguedad_rol || null, fecha || null,
                    fit_score ?? null, perfil_predominante || null, JSON.stringify(dimensiones || {}),
                    potencial_global || null, proyeccion_rol || null, observaciones || null, username
                ]
            );
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: "Ya existe un registro de Guía de Potencial para ese empleado en ese año" });
            }
            throw err;
        }

        res.status(201).json({ registro: registroResult.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando el registro de Guía de Potencial" });
    }
});

router.put("/rrhh-formularios/guia-potencial/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminRRHH(req, res))) return;

        const registroId = req.params.id;
        const { evaluador, antiguedad_rol, fecha, fit_score, perfil_predominante, dimensiones, potencial_global, proyeccion_rol, observaciones, estado } = req.body;

        const registroData = await pool.query("SELECT * FROM web.formulario_guia_potencial WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

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
        if (!(await requireAdminRRHH(req, res))) return;

        const registroData = await pool.query("SELECT * FROM web.formulario_guia_potencial WHERE id = $1", [req.params.id]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        if (registroData.rows[0].estado !== 'borrador') {
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
