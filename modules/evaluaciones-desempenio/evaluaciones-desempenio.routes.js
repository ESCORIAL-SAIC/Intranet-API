const express = require("express");
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { perteneceGrupo } = require("../../shared/grupos");

const router = express.Router();

router.get("/evaluacion", requireAuth, async (req, res) => {
    try{
        const allDatas = await pool.query("select qa.cuestionario_id, qa.tipo, qa.fechadesde, qa.fechahasta from web.v_intranet_eval_desemp_pre_res qa where not exists (select 1 from web.intranet_registro_eval_desemp qb where qb.cuestionario_id = qa.cuestionario_id and qb.usuario = $1) group by 1,2,3,4", [req.user.username]);

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

/* EXAMEN DESEMPEÑO */


//Valida si el usuario tiene permisos para acceder a dicha evaluacion
router.get("/validar-eval", requireAuth, async(req, res) => {
    const result = []
    try {
        const allDatas = await pool.query(`(
            SELECT Z.cuestionario_id,Z.usuario_evaluar,Z.tipo,Z.fechadesde,Z.fechahasta FROM web.v_intranet_desemp_pend Z WHERE ((Z.USUARIO_SISTEMA = $1 AND NOT EXISTS (SELECT 1 FROM	web.intranet_registro_eval_desemp qb WHERE qb.usuario_evaluar = $1 and  qb.usuario = $1 and qb.cuestionario_id = $2) AND PERMITE_AUTOEVALUACION <> FALSE ) OR (Z.usuario_sistema1 = $1 AND not exists (select 1 from web.intranet_registro_eval_desemp qb where qb.cuestionario_id = Z.cuestionario_id and (((qb.usuario = $1 and qb.usuario_evaluar = Z.USUARIO_SISTEMA))))) ) AND Z.cuestionario_id = $2 and Z.usuario_evaluar = $3
            )`,[req.user.username, req.headers.cuestionario,req.headers.usuario])
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
        console.log(err.message)
    }
})

//Obtiene un listado con las evaluacion pendientes a realizar del usuario
router.get("/evaluacion-desempenio-pend", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query(`(
            SELECT DISTINCT Z.cuestionario_id, Z.empleado_evaluar,Z.usuario_evaluar,Z.tipo,Z.fechadesde,Z.fechahasta, $1 as evaluador FROM web.v_intranet_desemp_pend Z WHERE
            (
                Z.USUARIO_SISTEMA = $1 AND PERMITE_AUTOEVALUACION <> FALSE
                AND
                not exists (
                    select 1 from  web.intranet_registro_eval_desemp qa
                    where qa.cuestionario_id = Z.cuestionario_id
                    and (qa.usuario = $1 and qa.usuario_evaluar = $1)
                )
            )
            OR
            (
                Z.usuario_sistema1 = $1
                AND
                not exists (
                    select 1 from web.intranet_registro_eval_desemp qb
                    where qb.cuestionario_id = Z.cuestionario_id
                    and (qb.usuario = $1 and qb.usuario_evaluar = Z.USUARIO_SISTEMA)
                )
            )
            )`, [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

//Muestra un listado con las preguntas y posibles respuestas de una evaluacion en especifico
router.get("/evaluacion-desempenio-det", requireAuth, async(req, res) => {
    const result = []
    try {
        const allDatas = await pool.query("select qa.* from web.v_intranet_eval_desemp_pre_res qa where not exists (select 1 from web.intranet_registro_eval_desemp qb where qb.cuestionario_id = qa.cuestionario_id and qb.usuario = $1 and qb.usuario_evaluar = $3) and qa.cuestionario_id = $2 order by qa.pregunta_id, qa.nivel", [req.user.username, req.headers.cuestionario, req.headers.usuario])
        let cuestionarioId = null
        let preguntaId = null
        let detalleP = ""
        let preguntas = []
        let respuestas = []
        let preguntaN = ""
        let autoEvaluacion = (req.user.username == req.headers.usuario)
        allDatas.rows.forEach(row => {
            if(row == allDatas.rows[0]){
                cuestionarioId = row.cuestionario_id
                preguntaId = row.pregunta_id
            }

            if (preguntaId == row.pregunta_id){
                respuestas.push({
                    "id": row.respuesta_id,
                    "respuesta": row.nivel,
                    "detalle": row.respuesta
                })
            }else{
                preguntas.push({
                    "id": preguntaId,
                    "pregunta": preguntaN,
                    "detalle": detalleP,
                    "respuestas": respuestas
                })
                respuestas = []
                respuestas.push({
                    "id": row.respuesta_id,
                    "respuesta": row.nivel,
                    "detalle": row.respuesta
                })
                }
            preguntaN = row.pregunta
            preguntaId = row.pregunta_id
            detalleP = row.detalle
        })

        preguntas.push({
            "id": preguntaId,
            "pregunta": preguntaN,
            "detalle": detalleP,
            "respuestas": respuestas
        })

        result.push({
            "id": cuestionarioId,
            "autoevaluacion": autoEvaluacion,
            "preguntas": preguntas
        })

        res.json(result)
    } catch (err) {
        console.log(err.message)
    }
})

//Muestra un listado de las evaluacion de desempenio completadas por el usuario
router.get("/evaluacion-desempenio-completas", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_eval_desemp_completas where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
        //res.json(result)
    } catch (err) {
        console.log(err.message)
    }
})

router.get("/evaluacion-desempenio-completas-p", requireAuth, async(req, res) => {
    let result = {}
    let query = ""
    try {
        const e = {
            username: req.user.username,
            grupousuario: "'rol_jefe_rrhh'"
        }

        const val = await perteneceGrupo(e);

        if(val){
            query = "select * from web.v_intranet_eval_desemp_completas"
        }
        else{
            query = "select * from web.v_intranet_eval_desemp_completas where usuario = '"+ req.user.username +"'"
        }


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


        // if(req.headers.empleado_id != "" && req.headers.empleado_id != null){
        //     registros = registros.filter(r => r.empleado_id == req.headers.empleado_id)
        // }

        result = {
            sectores: sectores,
            tipos: tipos,
            registros: registros
        }
        res.json(result)
    } catch (err) {
        console.log(err.message)
    }
})

//Muestra un listado de las evaluacion de desempenio completadas por el usuario
router.get("/evaluacion-desempenio-completas-full", requireAuth, async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_eval_desemp_completas")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

//Muestra en detalle las respuestas completadas en una evaluacion en especifico
router.get("/evaluacion-desempenio-completas-res", requireAuth, async(req, res) => {
    const result = []
    try {
        let preguntas = []
        let respuestas = []
        let pregunta = ''
        let superior = false
        let cuestionarioId = ''
        let empleadoEvaluar = ''
        let usuarioEvaluar = ''
        let tipo = ''
        let fecha = ''
        let feedback = ''
        let fechaFeedback = ''
        let autoEvaluacion = false
        const allDatas = await pool.query(`
        select *, UPPER(substring(z.usuario,1,2)) as inicial_usuario
        from web.v_intranet_eval_desemp_completas_respuestas z
        where (z.id = $1)
        or
        (z.usuario = (
        select usuario_evaluar from web.intranet_registro_eval_desemp re where re.id = $1 and re.cuestionario_id = z.cuestionario_id
        ) and z.usuario = z.usuario_evaluar)
        group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16
        order by z.pregunta, z.superior desc
        `, [req.headers.cuestionario])
        allDatas.rows.forEach(row => {
            if(row == allDatas.rows[0]){
                cuestionarioId = row.cuestionario_id
                empleadoEvaluar = row.empleado_evaluar
                usuarioEvaluar = row.usuario_evaluar
                pregunta = row.pregunta
                fecha = row.fecha
                tipo = row.encuesta
                feedback = row.feedback
                fechaFeedback = row.fecha_feedback
                autoEvaluacion = (req.user.username == row.usuario_evaluar)
            }
            if (pregunta == row.pregunta){
                respuestas.push({
                    "fecha":row.fecha,
                    "superior":row.superior,
                    "usuario":row.usuario,
                    "empleado": row.empleado,
                    "respuesta": row.respuesta,
                    "puntuacion": row.puntuacion,
                    "feedback": row.resfeedback,
                    "inicial": row.inicial_usuario
                })
            }else{
                preguntas.push({
                    "pregunta": pregunta,
                    "respuestas": respuestas
                })
                respuestas = []
                respuestas.push({
                    "fecha":row.fecha,
                    "superior":superior,
                    "usuario":row.usuario,
                    "empleado": row.empleado,
                    "respuesta": row.respuesta,
                    "puntuacion": row.puntuacion,
                    "feedback": row.resfeedback,
                    "inicial": row.inicial_usuario
                })
            }
        pregunta = row.pregunta
        })

        preguntas.push({
            "pregunta": pregunta,
            "respuestas": respuestas
        })

        result.push({
            "id": cuestionarioId,
            "fecha": fecha,
            "tipo": tipo,
            "usuario_evaluar": usuarioEvaluar,
            "empleado_evaluar": empleadoEvaluar,
            "feedback": feedback,
            "fechaFeedback": fechaFeedback,
            "autoEvaluacion": autoEvaluacion,
            "preguntas": preguntas
        })

        res.json(result)
    } catch (err) {
        console.log(err.message)
    }
})

//Recibe un json con las respuestas completas y las registra en una tabla con sus preguntas especificas
router.post("/enviar-evaluacion", requireAuth, async(req, res) => {
    try {
        await pool.query("insert into web.intranet_registro_eval_desemp (cuestionario_id, usuario, usuario_evaluar) values($1, $2, $3)",[req.headers.cuestionario, req.user.username, req.headers.usuario])

        if(req.user.username != req.headers.usuario){
            await pool.query("insert into web.intranet_registro_eval_desemp_feedback (registro_id, fecha_feedback) values((select id from web.intranet_registro_eval_desemp order by id desc limit 1),$1 ::timestamptz)",[req.body.feedbackFecha])
        }
        req.body.respuestas.forEach(async(ele) => {
            await pool.query("insert into web.intranet_registro_respuestas_eval_desemp (registro_id, pregunta_id, respuesta_id, feedback) values((select id from web.intranet_registro_eval_desemp order by id desc limit 1), $1, $2, $3)", [ele.preguntaId, ele.respuestaId, ele.feedback])
        });
    } catch (err) {
        console.log(err);
    }

    res.sendStatus(200)
})

router.post("/agregar-puntos-feedback", requireAuth, async(req, res) => {
    try{
        await pool.query("update web.intranet_registro_eval_desemp_feedback set feedback = $2 where registro_id = $1",[req.headers.cuestionario, req.body.feedback])
    } catch (err) {
        console.log(err);
    }

    res.sendStatus(200)
})

module.exports = router;
