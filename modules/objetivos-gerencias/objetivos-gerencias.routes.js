const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");

const router = express.Router();

/* Carga Objetivos Gerencias */

router.get("/objetivos-gerencias", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.intranet_objetivo_gerencia")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

router.put("/gerencias/:id", requireAuth, async(req, res) => {
    try {
        const gerenciaId = req.params.id;
        const { objetivo, descripcion } = req.body;

        // Validar que el ID sea válido
        if (!gerenciaId || isNaN(gerenciaId)) {
            return res.status(400).json({ error: "ID de gerencia inválido" });
        }

        // Validar que objetivo no esté vacío
        if (!objetivo || objetivo.trim() === '') {
            return res.status(400).json({ error: "El objetivo es requerido" });
        }

        // Actualizar en la base de datos
        const result = await pool.query(
            "UPDATE web.intranet_objetivo_gerencia SET objetivo = $1, descripcion = $2 WHERE id = $3 RETURNING *",
            [objetivo.trim(), descripcion ? descripcion.trim() : '', gerenciaId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Gerencia no encontrada" });
        }

        res.status(200).json({
            success: true,
            message: "Objetivo actualizado correctamente",
            data: result.rows[0]
        });

    } catch (err) {
        console.log("Error actualizando objetivo:", err);
        res.status(500).json({ error: "Error al actualizar el objetivo" });
    }
})

module.exports = router;
