const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");

const router = express.Router();

/* REGISTRO ESTUDIOS */

router.get("/estudios-clasificadores", requireAuth, async(req, res) => {
    const result = []
    const tipoEstudio = []
    const tipoProgreso = []
    try {
        const allDatas = await pool.query("select * from web.v_intranet_estudios_clasificadores")
        allDatas.rows.forEach(row => {
            if(row.tipo == "ESTUDIOS"){
                tipoEstudio.push(
                    {
                        "id": row.id,
                        "nombre": row.clasificador

                    }
                )
            }else if(row.tipo == "PROGRESO"){
                tipoProgreso.push(
                    {
                        "id": row.id,
                        "nombre": row.clasificador

                    }
                )
            }
        })
        result.push({
            "estudios": tipoEstudio,
            "progresos": tipoProgreso
        })
        res.json(result)
    } catch (err) {
        console.log(err)
    }
})

router.post("/enviar-estudios", requireAuth, async(req, res) => {
    try {
        req.body.forEach(async(ele) => {
            await pool.query("insert into web.intranet_registro_estudios (tipo_estudio_id, estudio, progreso_id, usuario) values($1, $2, $3, $4)", [ele.tipoEstudioId, ele.estudio, ele.progresoId, req.user.username])
        });
    } catch (err) {
        console.log(err);
    }

    res.sendStatus(200)
});

router.post("/modificar-estudios", requireAuth, async(req, res) => {
    const idsActuales = []
    const estudios = []
    const nuevosEstudios = []
    try {
        req.body.forEach(async(ele) => {
            if(ele.id > 0){
                idsActuales.push(ele.id)
                estudios.push(ele)
            }else{
                nuevosEstudios.push(ele)
            }
        });

        estudios.forEach(estudio => {
            modificarEstudios(estudio)
        });

        bajaEstudios(idsActuales, req.user.username)

        nuevosEstudios.forEach(estudio => {
            altaEstudios(estudio, req.user.username)
        });
    } catch (err) {
        console.log(err);
    }

    res.sendStatus(200)
});

router.get("/carga-estudios-pendiente", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query(`
        (select 0,null,null,'','',null,''
        from web.intranet_notificaciones notf
        where notf.activo = false and notf.id = 1
        )
        union all
        (select estudios.* from web.intranet_registro_estudios estudios
        where estudios.usuario = $1 )
        `, [req.user.username])
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
        console.log(err)
    }
})

router.get("/estudios-cargados", requireAuth, async(req, res) => {
    const result = []
    const respuestas = []
    const tipoEstudio = []
    const tipoProgreso = []
    try {
        const allDatas = await pool.query("select * from web.v_intranet_registro_estudios where usuario = $1 order by id", [req.user.username])
        allDatas.rows.forEach(row => {
            respuestas.push({
                "id":row.id,
                "respuestaTipo":row.tipo_estudio_id,
                "respuestaEstudio":row.estudio,
                "respuestaProgreso":row.progreso_id
            })
        })

        const allDatas2 = await pool.query("select * from web.v_intranet_estudios_clasificadores")
        allDatas2.rows.forEach(row => {
            if(row.tipo == "ESTUDIOS"){
                tipoEstudio.push(
                    {
                        "id": row.id,
                        "nombre": row.clasificador

                    }
                )
            }else if(row.tipo == "PROGRESO"){
                tipoProgreso.push(
                    {
                        "id": row.id,
                        "nombre": row.clasificador

                    }
                )
            }
        })
        result.push({
            "respuestas": respuestas,
            "estudios": tipoEstudio,
            "progresos": tipoProgreso
        })
        res.json(result)
    } catch (err) {
        console.log(err)
    }
})

async function altaEstudios(estudio, username){
    try {
        await pool.query("insert into web.intranet_registro_estudios (tipo_estudio_id, estudio, progreso_id, usuario) values($1, $2, $3, $4)", [estudio.tipoEstudioId, estudio.estudio, estudio.progresoId, username])
    } catch(err){
        console.log(err)
    }
}

async function bajaEstudios(idsVigentes, username){
    try {
        const allDatas = await pool.query("select id from web.v_intranet_registro_estudios where usuario = $1 order by id", [username])
        allDatas.rows.forEach(async row => {
            if(!idsVigentes.includes(row.id.toString())){
                await pool.query("delete from web.intranet_registro_estudios where id = $1", [row.id])
            }
        });
    } catch(err){
        console.log(err)
    }
}

async function modificarEstudios(estudio){
    try {
        if(estudio.id > 0){
            await pool.query("update web.intranet_registro_estudios set tipo_estudio_id = $1, estudio = $2, progreso_id = $3 where id = $4", [estudio.tipoEstudioId, estudio.estudio, estudio.progresoId, estudio.id])
        }
    } catch(err){
        console.log(err)
    }
}

module.exports = router;
