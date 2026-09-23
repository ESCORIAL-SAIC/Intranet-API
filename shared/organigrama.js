const { pool } = require("../config/db");

// Función auxiliar: Obtener gerencia/sector del usuario autenticado
// Usado por objetivos-anuales (para saber si el registro pertenece al usuario),
// por nuevebox y por rrhh-formularios (para ubicar sus reportes directos).
async function obtenerGerenciaDelUsuario(username) {
    try {
        const result = await pool.query(`
            SELECT
                g.id as gerencia_id,
                g.nombre as gerencia_nombre,
                emp.id as empleado_id,
                pers.nombre as empleado_nombre,
                s.nombre as sector_nombre,
                udemp.dependenciaorganigrama_id
            FROM ud_empleado udemp
            LEFT JOIN empleado emp ON emp.boextension_id = udemp.id
            LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
            LEFT JOIN gerencia g ON g.id = emp.gerencia_id
            left join sector s on s.id = emp.sector_id
            WHERE udemp.usuario_sistema = $1
            LIMIT 1
        `, [username]);

        return result.rows[0] || null;
    } catch (err) {
        console.log('Error obtener gerencia del usuario:', err);
        return null;
    }
}

// Función auxiliar: Obtener reportes directos del usuario (1 nivel jerárquico abajo,
// vía puestoorganigrama.dependencia_id). Usada por nuevebox y por rrhh-formularios.
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

module.exports = { obtenerGerenciaDelUsuario, obtenerReportesDirectos };
