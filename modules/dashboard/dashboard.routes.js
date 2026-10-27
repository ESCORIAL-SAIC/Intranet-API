const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");

const router = express.Router();

router.get("/perteneceagrupo", requireAuth, async (req, res) => {
    try{
        const grupos = req.headers.grupousuario.split(',');
        const placeholders = grupos.map((_, index) => `${_}`).join(',');
        const allDatas = await pool.query(`select * from web.v_intranet_usuarios_grupos where usuario = $1 and grupo in (${placeholders})`, [req.user.username]);

        if(allDatas.rows.length > 0){
            return res.status(200).send({
                success: true,
                user: {
                    id: req.user.id,
                    username: req.user.username,
                }
            })
        }else{
            return res.status(400).send({
                success: false
            })
        }
    } catch (err) {
        console.log(err.message);
    }
})

/* ELEMENTOS APP REACT */

router.get("/menu-button", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select id, name, link, img_icon, button_color from web.v_intranet_accesos where usuario = $1", [req.user.username]);
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

/* PESTAÑA PRINCIPAL */

router.get("/cumple", async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_cumpleanios limit 8");
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message);
    }
})

router.get("/comunicaciones", async(req, res) => {
    try {
        const allDatas = await pool.query("select fecha::date, asunto, replace(cuerpo,'<img src=''cid:imagen'' />','') cuerpo, imagen as imagen from web.envio_comunicaciones where inicio = true and enviado = true and imagen <> '' order by fecha desc LIMIT 6");
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/bienvenido", requireAuth, async(req, res) => {
    //res.render('main')
        try {
            const allDatas = await pool.query("select * from web.v_intranet_usuario_detallado where usuario = $1", [req.user.username]);
            res.json(allDatas.rows)
        } catch (err) {
            console.log(err.message)
        }
})

router.get("/usuario", requireAuth, async(req, res) => {
    // res.json({"usuario": req.user.username})

    try {
        const allDatas = await pool.query("select usuario, nombre from web.v_intranet_usuario_detallado where usuario = $1", [req.user.username]);

        res.json({"usuario": allDatas.rows[0].usuario, "nombre": allDatas.rows[0].nombre})
    } catch (err) {
        console.log(err.message)
    }

})

router.get("/capacitaciones", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_capacitaciones where usuario_sistema = $1", [req.user.username]);
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/insumos", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_insumos where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/eventos", async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_eventos where not (dia::int >= 9 and dia::int <= 22 and mes = 'FEB') limit 3")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/tareas-pend-cant", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_cant_pendiente where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/tareas", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_pendientes where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/powerbi-accesos", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from WEB.power_bi_accesos order by nombre")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

module.exports = router;
