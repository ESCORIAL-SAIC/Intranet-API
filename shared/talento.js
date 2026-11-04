const { pool } = require("../config/db");

/* Lógica compartida del proceso de Talent Review
   (ver info-prompts/talent-review-proceso-general.html).
   La usan rrhh-formularios (pendientes del líder), nuevebox (habilitación de la matriz)
   y talent-review (hub con el roadmap de cada usuario), para que los tres módulos
   evalúen el mismo estado con el mismo criterio. */

const TIPOS_FORMULARIO = {
    'riesgo-impacto': { dbTipo: 'riesgo_impacto', tabla: 'formulario_riesgo_impacto' },
    'guia-potencial': { dbTipo: 'guia_potencial', tabla: 'formulario_guia_potencial' },
};

// No se evalúa (ni con IA ni manualmente) a colaboradores con esta antigüedad o menos:
// no hay historial suficiente de desempeño/potencial para ubicarlos en una caja.
const ANTIGUEDAD_MINIMA_MESES_9BOX = 6;

function tieneAntiguedadInsuficiente(tenureMonths) {
    const meses = Number(tenureMonths);
    return Number.isFinite(meses) && meses <= ANTIGUEDAD_MINIMA_MESES_9BOX;
}

async function obtenerCicloVigente(dbTipo) {
    const result = await pool.query(
        "SELECT * FROM web.ciclo_formulario_rrhh WHERE tipo = $1 AND CURRENT_DATE BETWEEN fecha_desde AND fecha_hasta ORDER BY fecha_creacion DESC LIMIT 1",
        [dbTipo]
    );
    return result.rows[0] || null;
}

// Ciclo vigente o, si ya cerró, el último que arrancó. Sirve para evaluar si un líder
// completó los formularios aunque la ventana de carga ya haya terminado.
async function obtenerCicloActual(dbTipo) {
    const result = await pool.query(
        `SELECT *, (CURRENT_DATE BETWEEN fecha_desde AND fecha_hasta) AS vigente
         FROM web.ciclo_formulario_rrhh
         WHERE tipo = $1 AND fecha_desde <= CURRENT_DATE
         ORDER BY fecha_desde DESC, fecha_creacion DESC LIMIT 1`,
        [dbTipo]
    );
    return result.rows[0] || null;
}

// Estado de un formulario (Guía de Potencial / Riesgo e Impacto) para cada reporte directo
// dentro de un ciclo: 'pendiente' (sin registro) | 'borrador' | 'finalizado'.
async function obtenerEstadoFormulariosEquipo(tipo, ciclo, reportes) {
    const info = TIPOS_FORMULARIO[tipo];
    if (!ciclo || reportes.length === 0) return [];

    const empleadoIds = reportes.map(r => r.id);
    const placeholders = empleadoIds.map((_, i) => `$${i + 2}`).join(',');
    const existentes = await pool.query(
        `SELECT id, empleado_id, estado FROM web.${info.tabla} WHERE ciclo_id = $1 AND empleado_id IN (${placeholders})`,
        [ciclo.id, ...empleadoIds]
    );
    const porEmpleado = new Map(existentes.rows.map(r => [r.empleado_id, r]));

    return reportes.map(r => {
        const existente = porEmpleado.get(r.id);
        return {
            empleado_id: r.id,
            empleado_nombre: r.nombre,
            puesto: r.puesto,
            registro_id: existente ? existente.id : null,
            estado: existente ? existente.estado : 'pendiente',
        };
    });
}

// La matriz 9-box se habilita recién cuando el líder finalizó la Guía de Potencial y el
// formulario de Riesgo e Impacto de cada reporte directo que entra al 9-box (los de
// antigüedad insuficiente quedan afuera del ciclo, así que no bloquean).
async function evaluarHabilitacion9box(reportes) {
    const elegibles = reportes.filter(r => !tieneAntiguedadInsuficiente(r.tenure_months));
    const cicloPotencial = await obtenerCicloActual(TIPOS_FORMULARIO['guia-potencial'].dbTipo);
    const cicloRiesgo = await obtenerCicloActual(TIPOS_FORMULARIO['riesgo-impacto'].dbTipo);

    if (elegibles.length === 0) {
        return { habilitado: true, motivo: null, elegibles: 0, completos: 0, faltantes: [] };
    }

    const faltantesCiclo = [];
    if (!cicloPotencial) faltantesCiclo.push('Guía de Potencial');
    if (!cicloRiesgo) faltantesCiclo.push('Riesgo e Impacto de Pérdida');
    if (faltantesCiclo.length > 0) {
        return {
            habilitado: false,
            motivo: `RRHH todavía no abrió el ciclo de: ${faltantesCiclo.join(' y ')}.`,
            elegibles: elegibles.length,
            completos: 0,
            faltantes: [],
        };
    }

    const potencial = await obtenerEstadoFormulariosEquipo('guia-potencial', cicloPotencial, elegibles);
    const riesgo = await obtenerEstadoFormulariosEquipo('riesgo-impacto', cicloRiesgo, elegibles);
    const riesgoPorEmpleado = new Map(riesgo.map(r => [r.empleado_id, r.estado]));

    const faltantes = potencial
        .map(p => ({
            empleado_id: p.empleado_id,
            empleado_nombre: p.empleado_nombre,
            guia_potencial: p.estado,
            riesgo_impacto: riesgoPorEmpleado.get(p.empleado_id) || 'pendiente',
        }))
        .filter(f => f.guia_potencial !== 'finalizado' || f.riesgo_impacto !== 'finalizado');

    const habilitado = faltantes.length === 0;
    return {
        habilitado,
        motivo: habilitado
            ? null
            : `Falta finalizar la Guía de Potencial y/o el formulario de Riesgo e Impacto de ${faltantes.length} colaborador${faltantes.length === 1 ? '' : 'es'}.`,
        elegibles: elegibles.length,
        completos: elegibles.length - faltantes.length,
        faltantes,
    };
}

module.exports = {
    TIPOS_FORMULARIO,
    ANTIGUEDAD_MINIMA_MESES_9BOX,
    tieneAntiguedadInsuficiente,
    obtenerCicloVigente,
    obtenerCicloActual,
    obtenerEstadoFormulariosEquipo,
    evaluarHabilitacion9box,
};
