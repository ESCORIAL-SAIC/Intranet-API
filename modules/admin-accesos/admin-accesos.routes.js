const express = require("express");
const crypto = require("crypto");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { perteneceGrupo } = require("../../shared/grupos");

const router = express.Router();

/* ADMINISTRACIÓN DE ACCESOS — ABM de las solapas del menú y de los roles que las ven.
   Exclusivo grupo 'administradores'. Trabaja sobre las tablas que ya alimentan el menú
   (web.v_intranet_accesos → /menu-button):
     web.intranet_menu        una fila por solapa/acceso (name, link, img_icon, button_color, orden)
     web.intranet_menu_roles  relación solapa ↔ rol (rol_id = grupousuario.id)
   Un usuario ve la solapa si pertenece a alguno de sus roles (el rol 'Todos' la hace pública).
   Script de alta de la solapa en ADMIN_ACCESOS_DDL.sql. */

const GRUPO_ADMIN = "'administradores'";
const NOMBRE_GRUPO_ADMIN = 'administradores';

// La propia solapa de administración: no se puede eliminar ni quitarle el rol administradores,
// para que nadie se quede sin forma de volver a entrar.
const LINK_ADMIN_ACCESOS = '/admin-accesos';

async function requireAdmin(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: GRUPO_ADMIN });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para administradores" });
        return false;
    }
    return true;
}

function validarAcceso(body) {
    const name = (body.name || '').trim();
    const link = (body.link || '').trim();
    if (!name) return { error: "El nombre es obligatorio" };
    if (!link) return { error: "El link es obligatorio" };
    if (!link.startsWith('/') && !/^https?:\/\//i.test(link)) {
        return { error: "El link debe ser una ruta interna (/...) o una URL http(s)" };
    }
    const color = (body.button_color || 'ffffff').trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(color)) return { error: "El color debe ser hexadecimal de 6 dígitos" };
    let orden = null;
    if (body.orden !== undefined && body.orden !== null && body.orden !== '') {
        orden = Number(body.orden);
        if (!Number.isFinite(orden)) return { error: "El orden debe ser numérico" };
    }
    return {
        valores: [name, link, (body.img_icon || '').trim() || null, color.toLowerCase(), orden],
    };
}

async function obtenerAccesos(id = null) {
    const result = await pool.query(`
        SELECT m.id, m.name, m.link, m.img_icon, m.button_color, m.orden::float AS orden,
               COALESCE(json_agg(json_build_object('id', g.id, 'nombre', g.nombre, 'activo', g.activestatus = 0)
                                 ORDER BY g.nombre) FILTER (WHERE g.id IS NOT NULL), '[]') AS roles
        FROM web.intranet_menu m
        LEFT JOIN web.intranet_menu_roles r ON r.boton_id = m.id
        LEFT JOIN grupousuario g ON g.id = r.rol_id
        WHERE ($1::uuid IS NULL OR m.id = $1::uuid)
        GROUP BY m.id
        ORDER BY m.orden ASC NULLS LAST, m.name ASC
    `, [id]);
    return result.rows;
}

async function obtenerAcceso(id) {
    const rows = await obtenerAccesos(id);
    return rows[0] || null;
}

router.get("/admin-accesos/accesos", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdmin(req, res))) return;
        res.json({ accesos: await obtenerAccesos() });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los accesos" });
    }
});

router.get("/admin-accesos/roles", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdmin(req, res))) return;
        const result = await pool.query(`
            SELECT g.id, g.nombre, g.activestatus = 0 AS activo,
                   (SELECT COUNT(*)::int FROM web.v_intranet_usuarios_grupos ug WHERE ug.grupo = g.nombre AND ug.usuario IS NOT NULL) AS miembros
            FROM grupousuario g
            WHERE COALESCE(TRIM(g.nombre), '') <> ''
            ORDER BY g.nombre ASC
        `);
        res.json({ roles: result.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los roles" });
    }
});

router.post("/admin-accesos/accesos", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdmin(req, res))) return;
        const { error, valores } = validarAcceso(req.body);
        if (error) return res.status(400).json({ error });

        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO web.intranet_menu (id, name, link, img_icon, button_color, orden)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [id, ...valores]);
        res.status(201).json({ acceso: await obtenerAcceso(id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando el acceso" });
    }
});

router.put("/admin-accesos/accesos/:id", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdmin(req, res))) return;
        const { error, valores } = validarAcceso(req.body);
        if (error) return res.status(400).json({ error });

        const actual = await obtenerAcceso(req.params.id);
        if (!actual) return res.status(404).json({ error: "Acceso no encontrado" });
        if (actual.link === LINK_ADMIN_ACCESOS && valores[1] !== LINK_ADMIN_ACCESOS) {
            return res.status(400).json({ error: "No se puede cambiar el link de la solapa de administración de accesos" });
        }

        await pool.query(`
            UPDATE web.intranet_menu SET name = $2, link = $3, img_icon = $4, button_color = $5, orden = $6
            WHERE id = $1
        `, [req.params.id, ...valores]);
        res.json({ acceso: await obtenerAcceso(req.params.id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando el acceso" });
    }
});

router.delete("/admin-accesos/accesos/:id", requireAuth, async(req, res) => {
    const client = await pool.connect();
    try {
        if (!(await requireAdmin(req, res))) return;
        const actual = await client.query("SELECT link FROM web.intranet_menu WHERE id = $1", [req.params.id]);
        if (actual.rows.length === 0) return res.status(404).json({ error: "Acceso no encontrado" });
        if (actual.rows[0].link === LINK_ADMIN_ACCESOS) {
            return res.status(400).json({ error: "No se puede eliminar la solapa de administración de accesos" });
        }

        await client.query('BEGIN');
        await client.query("DELETE FROM web.intranet_menu_roles WHERE boton_id = $1", [req.params.id]);
        await client.query("DELETE FROM web.intranet_menu WHERE id = $1", [req.params.id]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(err);
        res.status(500).json({ error: "Error eliminando el acceso" });
    } finally {
        client.release();
    }
});

router.post("/admin-accesos/accesos/:id/roles", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdmin(req, res))) return;
        const { rol_id } = req.body;
        if (!rol_id) return res.status(400).json({ error: "Debe seleccionar un rol" });

        if (!(await obtenerAcceso(req.params.id))) return res.status(404).json({ error: "Acceso no encontrado" });
        const rol = await pool.query("SELECT 1 FROM grupousuario WHERE id = $1", [rol_id]);
        if (rol.rows.length === 0) return res.status(404).json({ error: "Rol no encontrado" });

        // intranet_menu_roles no tiene PK/unique: se evita el duplicado acá.
        await pool.query(`
            INSERT INTO web.intranet_menu_roles (boton_id, rol_id)
            SELECT $1, $2
            WHERE NOT EXISTS (SELECT 1 FROM web.intranet_menu_roles WHERE boton_id = $1 AND rol_id = $2)
        `, [req.params.id, rol_id]);
        res.json({ acceso: await obtenerAcceso(req.params.id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error agregando el rol" });
    }
});

router.delete("/admin-accesos/accesos/:id/roles/:rolId", requireAuth, async(req, res) => {
    try {
        if (!(await requireAdmin(req, res))) return;
        const acceso = await obtenerAcceso(req.params.id);
        if (!acceso) return res.status(404).json({ error: "Acceso no encontrado" });
        const rol = acceso.roles.find(r => r.id === req.params.rolId);
        if (acceso.link === LINK_ADMIN_ACCESOS && rol && rol.nombre === NOMBRE_GRUPO_ADMIN) {
            return res.status(400).json({ error: "No se puede quitar el rol administradores de la solapa de administración de accesos" });
        }

        await pool.query("DELETE FROM web.intranet_menu_roles WHERE boton_id = $1 AND rol_id = $2", [req.params.id, req.params.rolId]);
        res.json({ acceso: await obtenerAcceso(req.params.id) });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error quitando el rol" });
    }
});

module.exports = router;
