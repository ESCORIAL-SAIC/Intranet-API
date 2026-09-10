const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { perteneceGrupo } = require("../../shared/grupos");
const { obtenerGerenciaDelUsuario } = require("../../shared/organigrama");

const router = express.Router();

/* OBJETIVOS ANUALES */

async function requireAdminObjetivos(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: "'Direccion','administradores','rrhh'" });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para Dirección/administradores/RRHH" });
        return false;
    }
    return true;
}

// Las siguientes 4 funciones deben reflejar exactamente la misma lógica que
// components/Modules/ObjetivosAnuales/utils.js en el frontend, para que el puntaje que
// se ve en vivo mientras se carga un resultado coincida con el que persiste el backend.

function parsearResultado(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = parseFloat(String(raw).replace(',', '.').replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
}

// Nota: umbral_score1 ("No alcanza") se guarda y se puede editar como los demás umbrales,
// pero no participa de esta cuenta — el puntaje 1 sigue siendo el resultado por defecto
// cuando el resultado no alcanza el umbral del puntaje 2. Queda como referencia visual/de
// carga para el evaluador (ej. el piso esperado del pilar).
function calcularPuntajePilarObjetivo(pilar, resultadoReal) {
    const val = parsearResultado(resultadoReal);
    if (val === null) return null;
    const alcanza = pilar.direccion === 'lower'
        ? (v, umbral) => v <= umbral
        : (v, umbral) => v >= umbral;
    if (alcanza(val, Number(pilar.umbral_score5))) return 5;
    if (alcanza(val, Number(pilar.umbral_score4))) return 4;
    if (alcanza(val, Number(pilar.umbral_score3))) return 3;
    if (alcanza(val, Number(pilar.umbral_score2))) return 2;
    return 1;
}

function calcularPuntajeFinalObjetivos(pilares) {
    const anyScored = pilares.some(p => p.puntaje !== null && p.puntaje !== undefined);
    const completo = pilares.length > 0 && pilares.every(p => p.puntaje !== null && p.puntaje !== undefined);
    if (!anyScored) return { puntajeFinal: null, completo };
    const weightedSum = pilares.reduce((acc, p) => acc + (Number(p.puntaje) || 0) * Number(p.peso), 0);
    return { puntajeFinal: Number((weightedSum / 100).toFixed(2)), completo };
}

function pesosPilaresValidos(pilares) {
    const suma = pilares.reduce((acc, p) => acc + Number(p.peso || 0), 0);
    return Math.abs(suma - 100) < 0.01;
}

// Cada pilar debe pesar entre PESO_MIN y PESO_MAX %, y un registro debe tener entre
// PILARES_MIN y PILARES_MAX pilares (debe reflejar exactamente lo mismo que
// components/Modules/ObjetivosAnuales/constants.js y utils.js en el frontend).
const PESO_MIN_PILAR = 10;
const PESO_MAX_PILAR = 40;
const PILARES_MIN = 3;
const PILARES_MAX = 5;

function pesoPilarValido(peso) {
    const n = Number(peso);
    return Number.isFinite(n) && n >= PESO_MIN_PILAR && n <= PESO_MAX_PILAR;
}

function todosLosPesosEnRango(pilares) {
    return pilares.every(p => pesoPilarValido(p.peso));
}

function cantidadPilaresValida(pilares) {
    return pilares.length >= PILARES_MIN && pilares.length <= PILARES_MAX;
}

const OBJETIVO_ANUAL_SELECT = `
    SELECT
        r.*,
        pers.nombre AS empleado_nombre,
        s.nombre AS area,
        g.nombre AS gerencia
    FROM web.registro_objetivo_anual r
    LEFT JOIN empleado emp ON emp.id = r.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
`;

// GET: listado de registros — admin ve todos, el resto sólo el propio y publicado
router.get("/objetivos-anuales", requireAuth, async(req, res) => {
    try {
        const username = req.user.username;
        const esAdmin = await perteneceGrupo({ username, grupousuario: "'Direccion','administradores','rrhh'" });

        if (esAdmin) {
            const allDatas = await pool.query(`${OBJETIVO_ANUAL_SELECT} ORDER BY r.anio DESC, pers.nombre ASC`);
            return res.json({ es_admin: true, registros: allDatas.rows });
        }

        const infoUsuario = await obtenerGerenciaDelUsuario(username);
        if (!infoUsuario || !infoUsuario.empleado_id) {
            return res.json({ es_admin: false, registros: [] });
        }

        const allDatas = await pool.query(
            `${OBJETIVO_ANUAL_SELECT} WHERE r.empleado_id = $1 AND r.estado = 'publicado' ORDER BY r.anio DESC`,
            [infoUsuario.empleado_id]
        );
        res.json({ es_admin: false, registros: allDatas.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los objetivos anuales" });
    }
});

// GET: detalle de un registro + sus pilares
router.get("/objetivos-anuales/:id", requireAuth, async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;

        const registroData = await pool.query(`${OBJETIVO_ANUAL_SELECT} WHERE r.id = $1`, [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        const esAdmin = await perteneceGrupo({ username, grupousuario: "'Direccion','administradores','rrhh'" });
        if (!esAdmin) {
            const infoUsuario = await obtenerGerenciaDelUsuario(username);
            const esPropio = infoUsuario && infoUsuario.empleado_id === registro.empleado_id;
            if (!esPropio || registro.estado !== 'publicado') {
                return res.status(403).json({ error: "No tenés acceso a este registro" });
            }
        }

        const pilaresData = await pool.query(
            "SELECT * FROM web.objetivo_anual_pilar WHERE registro_id = $1 ORDER BY orden ASC",
            [registroId]
        );

        res.json({ registro, pilares: pilaresData.rows, puede_editar: esAdmin });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el registro" });
    }
});

// POST: crear un registro (ciclo anual de un empleado) con sus pilares, en borrador
router.post("/objetivos-anuales", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const { empleado_id, anio, evaluador, pilares } = req.body;
        const username = req.user.username;

        if (!empleado_id || !anio) {
            return res.status(400).json({ error: "empleado_id y anio son requeridos" });
        }
        if (!Array.isArray(pilares) || pilares.length === 0) {
            return res.status(400).json({ error: "Debe cargar al menos un pilar" });
        }
        if (!cantidadPilaresValida(pilares)) {
            return res.status(400).json({ error: `Un registro debe tener entre ${PILARES_MIN} y ${PILARES_MAX} pilares` });
        }
        if (!todosLosPesosEnRango(pilares)) {
            return res.status(400).json({ error: `Cada pilar debe pesar entre ${PESO_MIN_PILAR}% y ${PESO_MAX_PILAR}%` });
        }
        if (!pesosPilaresValidos(pilares)) {
            return res.status(400).json({ error: "La suma de los pesos de los pilares debe ser 100" });
        }

        const empleadoData = await pool.query(`
            SELECT puesto.nombre AS puesto
            FROM empleado emp
            LEFT JOIN ud_empleado ude ON ude.id = emp.boextension_id
            LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
            WHERE emp.id = $1
        `, [empleado_id]);
        const puestoSnapshot = empleadoData.rows[0] ? empleadoData.rows[0].puesto : null;

        const registroId = require('crypto').randomUUID();
        let registroResult;
        try {
            registroResult = await pool.query(
                `INSERT INTO web.registro_objetivo_anual
                 (id, empleado_id, anio, puesto_snapshot, evaluador, estado, creado_por, fecha_creacion)
                 VALUES ($1, $2, $3, $4, $5, 'borrador', $6, NOW()) RETURNING *`,
                [registroId, empleado_id, anio, puestoSnapshot, evaluador || null, username]
            );
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: "Ya existe un registro de objetivos anuales para ese empleado en ese año" });
            }
            throw err;
        }

        const pilaresInsertados = [];
        for (let i = 0; i < pilares.length; i++) {
            const p = pilares[i];
            const pilarResult = await pool.query(
                `INSERT INTO web.objetivo_anual_pilar
                 (id, registro_id, orden, nombre, descripcion, peso, unidad, direccion,
                  umbral_score1, umbral_score2, umbral_score3, umbral_score4, umbral_score5)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
                [
                    require('crypto').randomUUID(), registroId, i,
                    p.nombre, p.descripcion || null, p.peso, p.unidad || null, p.direccion,
                    p.umbral_score1, p.umbral_score2, p.umbral_score3, p.umbral_score4, p.umbral_score5
                ]
            );
            pilaresInsertados.push(pilarResult.rows[0]);
        }

        res.status(201).json({ registro: registroResult.rows[0], pilares: pilaresInsertados });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando el registro de objetivos anuales" });
    }
});

// PUT: reemplazar la definición de pilares de un registro (sólo mientras está en borrador)
router.put("/objetivos-anuales/:id/pilares", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const { pilares } = req.body;

        if (!Array.isArray(pilares) || pilares.length === 0) {
            return res.status(400).json({ error: "Debe cargar al menos un pilar" });
        }
        if (!cantidadPilaresValida(pilares)) {
            return res.status(400).json({ error: `Un registro debe tener entre ${PILARES_MIN} y ${PILARES_MAX} pilares` });
        }
        if (!todosLosPesosEnRango(pilares)) {
            return res.status(400).json({ error: `Cada pilar debe pesar entre ${PESO_MIN_PILAR}% y ${PESO_MAX_PILAR}%` });
        }
        if (!pesosPilaresValidos(pilares)) {
            return res.status(400).json({ error: "La suma de los pesos de los pilares debe ser 100" });
        }

        const registroData = await pool.query("SELECT * FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        if (registroData.rows[0].estado !== 'borrador') {
            return res.status(400).json({ error: "Sólo se pueden editar los pilares de un registro en borrador" });
        }

        await pool.query("DELETE FROM web.objetivo_anual_pilar WHERE registro_id = $1", [registroId]);

        const pilaresInsertados = [];
        for (let i = 0; i < pilares.length; i++) {
            const p = pilares[i];
            const pilarResult = await pool.query(
                `INSERT INTO web.objetivo_anual_pilar
                 (id, registro_id, orden, nombre, descripcion, peso, unidad, direccion,
                  umbral_score1, umbral_score2, umbral_score3, umbral_score4, umbral_score5)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
                [
                    require('crypto').randomUUID(), registroId, i,
                    p.nombre, p.descripcion || null, p.peso, p.unidad || null, p.direccion,
                    p.umbral_score1, p.umbral_score2, p.umbral_score3, p.umbral_score4, p.umbral_score5
                ]
            );
            pilaresInsertados.push(pilarResult.rows[0]);
        }

        await pool.query("UPDATE web.registro_objetivo_anual SET fecha_actualizacion = NOW() WHERE id = $1", [registroId]);

        res.json({ pilares: pilaresInsertados });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando los pilares" });
    }
});

// PUT: cargar el resultado real de un pilar y recalcular puntajes (pilar + final del registro)
router.put("/objetivos-anuales/:id/pilar/:pilar_id/resultado", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const pilarId = req.params.pilar_id;
        const { resultado_real } = req.body;

        const pilarData = await pool.query(
            "SELECT * FROM web.objetivo_anual_pilar WHERE id = $1 AND registro_id = $2",
            [pilarId, registroId]
        );
        if (pilarData.rows.length === 0) {
            return res.status(404).json({ error: "Pilar no encontrado" });
        }

        const puntaje = calcularPuntajePilarObjetivo(pilarData.rows[0], resultado_real);

        const pilarActualizado = await pool.query(
            `UPDATE web.objetivo_anual_pilar
             SET resultado_real = $1, puntaje = $2, fecha_resultado_cargado = NOW()
             WHERE id = $3 RETURNING *`,
            [parsearResultado(resultado_real), puntaje, pilarId]
        );

        const todosPilares = await pool.query(
            "SELECT * FROM web.objetivo_anual_pilar WHERE registro_id = $1",
            [registroId]
        );
        const { puntajeFinal, completo } = calcularPuntajeFinalObjetivos(todosPilares.rows);

        const registroActualizado = await pool.query(
            "UPDATE web.registro_objetivo_anual SET puntaje_final = $1, fecha_actualizacion = NOW() WHERE id = $2 RETURNING *",
            [puntajeFinal, registroId]
        );

        res.json({ pilar: pilarActualizado.rows[0], registro: registroActualizado.rows[0], completo });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error cargando el resultado del pilar" });
    }
});

// PUT: actualizar datos generales del registro (evaluador, año) o publicarlo
router.put("/objetivos-anuales/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const { estado, evaluador, anio } = req.body;

        const registroData = await pool.query("SELECT * FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        if (estado === 'publicado' && registro.estado !== 'publicado') {
            const pilaresData = await pool.query("SELECT * FROM web.objetivo_anual_pilar WHERE registro_id = $1", [registroId]);
            const faltantes = pilaresData.rows.filter(p => p.puntaje === null || p.puntaje === undefined);
            if (faltantes.length > 0) {
                return res.status(400).json({
                    error: "Faltan resultados por cargar antes de publicar",
                    pilares_pendientes: faltantes.map(p => p.nombre)
                });
            }
        }

        const nuevoEstado = estado || registro.estado;
        const result = await pool.query(
            `UPDATE web.registro_objetivo_anual
             SET estado = $1,
                 evaluador = COALESCE($2, evaluador),
                 anio = COALESCE($3, anio),
                 fecha_publicacion = CASE WHEN $1 = 'publicado' AND fecha_publicacion IS NULL THEN NOW() ELSE fecha_publicacion END,
                 fecha_actualizacion = NOW()
             WHERE id = $4 RETURNING *`,
            [nuevoEstado, evaluador || null, anio || null, registroId]
        );

        res.json({ registro: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando el registro" });
    }
});

// DELETE: eliminar un registro creado por error (sólo mientras está en borrador)
router.delete("/objetivos-anuales/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const registroData = await pool.query("SELECT * FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        if (registroData.rows[0].estado !== 'borrador') {
            return res.status(400).json({ error: "Sólo se pueden eliminar registros en borrador" });
        }

        await pool.query("DELETE FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        res.json({ success: true });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando el registro" });
    }
});

module.exports = router;
