const { pool } = require("../config/db");

// Función auxiliar: Obtener gerencia/sector del usuario autenticado
// Usado por objetivos-anuales (para saber si el registro pertenece al usuario)
// y por nuevebox (para ubicar sus reportes directos).
async function obtenerGerenciaDelUsuario(username) {
    try {
        const result = await pool.query(`
            SELECT
                g.id as gerencia_id,
                g.nombre as gerencia_nombre,
                emp.id as empleado_id,
                s.nombre as sector_nombre,
                udemp.dependenciaorganigrama_id
            FROM ud_empleado udemp
            LEFT JOIN empleado emp ON emp.boextension_id = udemp.id
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

module.exports = { obtenerGerenciaDelUsuario };
