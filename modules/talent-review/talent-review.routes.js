const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { obtenerGerenciaDelUsuario, obtenerReportesDirectos } = require("../../shared/organigrama");
const {
    TIPOS_FORMULARIO,
    obtenerCicloActual,
    obtenerEstadoFormulariosEquipo,
    evaluarHabilitacion9box,
    tieneAntiguedadInsuficiente,
} = require("../../shared/talento");

const router = express.Router();

/* TALENT REVIEW — hub del proceso (ver info-prompts/talent-review-proceso-general.html)
   No guarda nada propio: junta en un solo endpoint el estado de cada herramienta que ya
   existe (evaluaciones de desempeño, CV interno, objetivos anuales, formularios RRHH y
   9-box) para armar el checklist del colaborador y el roadmap del líder.
     Fase 0 (Recolección): colaborador → autoevaluación, CV interno, formulario Mi Persona
                           (web.formulario_mipersona, por DNI).
                           líder → evaluación de desempeño de su equipo, cierre de objetivos.
     Fase 1 (Mapeo):       líder → Guía de Potencial + Riesgo e Impacto, y recién con
                           ambos finalizados para todo el equipo, la matriz 9-box. */

// Asignaciones de evaluación de desempeño (autoevaluación o líder → colaborador),
// marcando cuáles ya tienen un registro cargado en el mismo cuestionario.
async function obtenerEvaluacionesDesempenio(username, comoLider) {
    const filtro = comoLider
        ? "Z.usuario_sistema1 = $1"
        : "Z.usuario_sistema = $1 AND Z.permite_autoevaluacion <> FALSE";
    const result = await pool.query(`
        SELECT DISTINCT
            Z.cuestionario_id, Z.empleado_evaluar, Z.usuario_evaluar, Z.tipo, Z.fechadesde, Z.fechahasta,
            EXISTS (
                SELECT 1 FROM web.intranet_registro_eval_desemp q
                WHERE q.cuestionario_id = Z.cuestionario_id
                AND q.usuario = $1 AND q.usuario_evaluar = Z.usuario_sistema
            ) AS completada
        FROM web.v_intranet_desemp_pend Z
        WHERE ${filtro}
    `, [username]);
    return result.rows;
}

async function obtenerCVInterno(empleadoId) {
    if (!empleadoId) return [];
    const result = await pool.query(
        "SELECT id, nombre_archivo, fecha FROM web.intranet_cv WHERE empleado_id = $1 ORDER BY fecha DESC",
        [empleadoId]
    );
    return result.rows;
}

// Formulario Mi Persona: se considera completo si hay respuestas cargadas con el DNI del
// empleado (una fila por pregunta). Se comparan solo dígitos por si alguno trae puntos.
async function obtenerMiPersona(username) {
    const result = await pool.query(`
        SELECT MAX(f.fecha) AS fecha
        FROM web.formulario_mipersona f
        JOIN empleado e ON regexp_replace(e.numerodocumento, '[^0-9]', '', 'g') = regexp_replace(f.dni, '[^0-9]', '', 'g')
        JOIN ud_empleado ude ON ude.id = e.boextension_id
        WHERE ude.usuario_sistema = $1
    `, [username]);
    return result.rows[0] ? result.rows[0].fecha : null;
}

// Objetivos anuales del equipo para el año: cerrado = todos los pilares con puntaje.
// empleado_id es integer en registro_objetivo_anual, por eso se compara como texto.
async function obtenerObjetivosEquipo(reportes, anio) {
    if (reportes.length === 0) return [];
    const result = await pool.query(`
        SELECT
            r.id, r.empleado_id::text AS empleado_id, r.estado, r.puntaje_final,
            COUNT(p.id)::int AS pilares,
            COUNT(p.puntaje)::int AS pilares_con_puntaje
        FROM web.registro_objetivo_anual r
        LEFT JOIN web.objetivo_anual_pilar p ON p.registro_id = r.id
        WHERE r.anio = $1 AND r.empleado_id::text = ANY($2::text[])
        GROUP BY r.id
    `, [anio, reportes.map(r => String(r.id))]);
    const porEmpleado = new Map(result.rows.map(r => [r.empleado_id, r]));

    return reportes.map(rep => {
        const reg = porEmpleado.get(String(rep.id));
        let estado = 'sin_cargar';
        if (reg) estado = reg.pilares > 0 && reg.pilares === reg.pilares_con_puntaje ? 'cerrado' : 'pendiente';
        return {
            empleado_id: rep.id,
            registro_id: reg ? reg.id : null,
            estado,
            puntaje_final: reg ? reg.puntaje_final : null,
        };
    });
}

async function obtenerRegistro9box(username, anio) {
    const result = await pool.query(
        "SELECT id, nombre, anio, estado FROM web.registro_9box WHERE creado_por = $1 AND anio = $2 ORDER BY fecha_creacion DESC LIMIT 1",
        [username, anio]
    );
    return result.rows[0] || null;
}

function resumen(items, esCompleto) {
    return { total: items.length, completos: items.filter(esCompleto).length };
}

router.get("/talent-review/estado", requireAuth, async(req, res) => {
    try {
        const username = req.user.username;
        const anio = new Date().getFullYear();

        const [infoUsuario, reportes, autoevaluaciones, evaluacionesLider] = await Promise.all([
            obtenerGerenciaDelUsuario(username),
            obtenerReportesDirectos(username),
            obtenerEvaluacionesDesempenio(username, false),
            obtenerEvaluacionesDesempenio(username, true),
        ]);
        const cvs = await obtenerCVInterno(infoUsuario ? infoUsuario.empleado_id : null);
        const fechaMiPersona = await obtenerMiPersona(username);

        const colaborador = {
            autoevaluacion: {
                estado: autoevaluaciones.length === 0
                    ? 'sin_asignar'
                    : autoevaluaciones.every(a => a.completada) ? 'completo' : 'pendiente',
                items: autoevaluaciones,
            },
            cv_interno: {
                estado: cvs.length > 0 ? 'completo' : 'pendiente',
                ultima_carga: cvs[0] ? cvs[0].fecha : null,
            },
            mi_persona: {
                estado: fechaMiPersona ? 'completo' : 'pendiente',
                fecha: fechaMiPersona,
            },
        };

        const esLider = reportes.length > 0 || evaluacionesLider.length > 0;
        if (!esLider) {
            return res.json({ anio, usuario: infoUsuario ? infoUsuario.empleado_nombre : username, es_lider: false, colaborador, lider: null });
        }

        const cicloPotencial = await obtenerCicloActual(TIPOS_FORMULARIO['guia-potencial'].dbTipo);
        const cicloRiesgo = await obtenerCicloActual(TIPOS_FORMULARIO['riesgo-impacto'].dbTipo);
        const [objetivos, potencial, riesgo, habilitacion9box, registro9box] = await Promise.all([
            obtenerObjetivosEquipo(reportes, anio),
            obtenerEstadoFormulariosEquipo('guia-potencial', cicloPotencial, reportes),
            obtenerEstadoFormulariosEquipo('riesgo-impacto', cicloRiesgo, reportes),
            evaluarHabilitacion9box(reportes),
            obtenerRegistro9box(username, anio),
        ]);

        const objetivosPorEmpleado = new Map(objetivos.map(o => [o.empleado_id, o]));
        const potencialPorEmpleado = new Map(potencial.map(p => [p.empleado_id, p]));
        const riesgoPorEmpleado = new Map(riesgo.map(r => [r.empleado_id, r]));

        // Matriz equipo × herramienta para el roadmap del líder
        const equipo = reportes.map(rep => {
            const evals = evaluacionesLider.filter(e => e.usuario_evaluar === rep.usuario_sistema);
            return {
                empleado_id: rep.id,
                nombre: rep.nombre,
                puesto: rep.puesto,
                entra_9box: !tieneAntiguedadInsuficiente(rep.tenure_months),
                evaluacion: evals.length === 0 ? 'sin_asignar' : evals.every(e => e.completada) ? 'completo' : 'pendiente',
                evaluacion_link: evals.find(e => !e.completada) || null,
                objetivos: objetivosPorEmpleado.get(rep.id).estado,
                guia_potencial: potencialPorEmpleado.has(rep.id) ? potencialPorEmpleado.get(rep.id).estado : 'sin_ciclo',
                riesgo_impacto: riesgoPorEmpleado.has(rep.id) ? riesgoPorEmpleado.get(rep.id).estado : 'sin_ciclo',
            };
        });

        const lider = {
            equipo,
            evaluaciones: { ...resumen(evaluacionesLider, e => e.completada), items: evaluacionesLider },
            objetivos: resumen(objetivos, o => o.estado === 'cerrado'),
            guia_potencial: { ciclo: cicloPotencial, ...resumen(potencial, p => p.estado === 'finalizado') },
            riesgo_impacto: { ciclo: cicloRiesgo, ...resumen(riesgo, r => r.estado === 'finalizado') },
            nuevebox: { ...habilitacion9box, registro: registro9box },
        };

        res.json({ anio, usuario: infoUsuario ? infoUsuario.empleado_nombre : username, es_lider: true, colaborador, lider });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el estado del Talent Review" });
    }
});

// Usado por la pantalla de 9-box para deshabilitar "Nuevo registro" con el mismo criterio
// que valida POST /nuevebox.
router.get("/talent-review/habilitacion-9box", requireAuth, async(req, res) => {
    try {
        const reportes = await obtenerReportesDirectos(req.user.username);
        res.json(await evaluarHabilitacion9box(reportes));
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error evaluando la habilitación del 9-box" });
    }
});

module.exports = router;
