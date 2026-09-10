const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");

const router = express.Router();

/* EMPLEADOS */

router.get("/empleados", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.intranet_registro_estudios where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

/* LOCKERS */

router.get("/lockers", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_lockers where planta = $1", [req.query.planta])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

/* SECCION DETALLADA DE EMPLEADOS */

router.get("/empleado-detalle", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.v_intranet_empleado_detalle where id = $1", [req.headers.empleado_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

router.get("/legajos-empleados", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT empleado_id, empleado, legajo, puesto, image FROM web.v_intranet_plan_capacitacion_empleados group by 1,2,3,4,5")

        let data = allDatas.rows;
        let busqueda = req.headers.busqueda;

        if (busqueda !== ""){
            data = data.filter(item =>
                (item.empleado && item.empleado.toLowerCase().includes(busqueda))
            );
        }

        res.json(data)

    } catch (err) {
        console.log(err)
    }
})

router.get("/empleado-puesto", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT puesto_pdf as puesto FROM web.v_intranet_puestos_empleados where empleado_id = $1",[req.headers.empleado_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

router.get("/empleado-cuestionarios", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.v_intranet_formulario_capacitacion where empleado_id = $1",[req.headers.empleado_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

router.get("/empleado-cuestionarios-detalle", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.v_intranet_formulario_capacitacion where id = $1",[req.headers.cuestionario_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

router.get("/empleado-desempenio", requireAuth, async(req, res) => {
    let result = {}
    let query = ""
    try {
        query = "select DISTINCT ON (tipo_id, empleado_evaluar) * from web.v_intranet_eval_desemp_completas"

        const sectores = []
        const tipos = []
        let registros = []

        const allDatas = await pool.query(query)

        allDatas.rows.forEach(row => {
            if(!sectores.some(e => e.id === row.sector_id)){
                sectores.push(
                    {
                        id: row.sector_id,
                        descripcion: row.sector
                    }
                )
            }
            if(!tipos.some(e => e.id === row.tipo_id)){
                tipos.push(
                    {
                        id: row.tipo_id,
                        descripcion: row.tipo
                    }
                )
            }

            //Oculto registros duplicados (muestro los que no son autoevaluaciones)
            if(registros.some(r => r.tipo_id === row.tipo_id && r.empleado_evaluar === row.empleado_evaluar)){
                if(row.usuario != row.usuario_evaluar){
                    registros = registros.filter(r => !(r.tipo_id === row.tipo_id && r.empleado_evaluar === row.empleado_evaluar && r.ususario === r.usuario_evaluar))
                    registros.push(row)
                }
            }else{
                registros.push(row)
            }
        })

        //Filtros

        if(req.headers.sector != "" && req.headers.sector != null){
            registros = registros.filter(r => r.sector_id == req.headers.sector)
        }

        if(req.headers.tipo != "" && req.headers.tipo != null){
            registros = registros.filter(r => r.tipo_id == req.headers.tipo)
        }

        if(req.headers.busqueda != "" && req.headers.busqueda != null){
            registros = registros.filter(r => r.empleado_evaluar.toLowerCase().includes(req.headers.busqueda.toLowerCase()))
        }


        if(req.headers.empleado_id != "" && req.headers.empleado_id != null){
            registros = registros.filter(r => r.empleado_id == req.headers.empleado_id)
        }

        result = {
            sectores: sectores,
            tipos: tipos,
            registros: registros
        }
        res.json(result)
    } catch (err) {
        console.log(err)
    }
})

router.get("/empleado-genoma", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query(
            "SELECT fecha, tipo_eval, evaluacion, resultado FROM web.genoma_registros WHERE empleado_id = $1 ORDER BY fecha DESC, tipo_eval, evaluacion",
            [req.headers.empleado_id]
        )
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
        res.status(500).json({ error: "Error obteniendo datos de Genoma" })
    }
})

router.get("/empleado-cv-datos", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query(
            "SELECT cv_datos, nombre_archivo, fecha FROM web.intranet_cv WHERE empleado_id = $1 ORDER BY fecha DESC LIMIT 1",
            [req.headers.empleado_id]
        )
        res.json(allDatas.rows[0] || null)
    } catch (err) {
        console.log(err)
        res.status(500).json({ error: "Error obteniendo datos de CV" })
    }
})

module.exports = router;
