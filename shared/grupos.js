const { pool } = require("../config/db");

/**
 * Indica si el usuario pertenece a alguno de los grupos indicados.
 * Usado como chequeo de permisos ad-hoc (no es un middleware de ruta:
 * se llama dentro del handler porque el criterio de acceso varía según
 * el endpoint, ej. solo Direccion/administradores/rrhh puede editar).
 *
 * @param {{ username: string, grupousuario: string }} e - grupousuario es
 *   una lista de grupos ya formateada para el IN de SQL, ej. "'rrhh'" o
 *   "'Direccion','administradores','rrhh'".
 */
async function perteneceGrupo(e) {
    try {
        const grupos = e.grupousuario.split(',');
        const placeholders = grupos.map((_, index) => `${_}`).join(',');
        const allDatas = await pool.query(`select * from web.v_intranet_usuarios_grupos where usuario = $1 and grupo in (${placeholders})`, [e.username]);

        if (allDatas.rows.length > 0) {
            return true
        } else {
            return false
        }
    } catch (err) {
        return false
    }
}

module.exports = { perteneceGrupo };
