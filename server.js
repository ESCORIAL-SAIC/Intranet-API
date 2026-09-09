
const express = require("express");
const app = express();
const cors = require("cors");
const fs = require("fs");
const path = require('path');
const { pool } = require("./config/db");
const session = require("express-session")
const flash = require("express-flash")
const passport = require("passport")
const jwt = require('jsonwebtoken')
const OpenAI = require("openai");
const PdfReader = require('pdfreader').PdfReader;
const { parse } = require('csv-parse/sync');
const multer = require('multer');

require("dotenv").config();

require('./config/passportJWT')

app.use(cors());
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(passport.initialize())

app.use(flash())

/* VALIDACION PASSPORT */

app.post("/login",
    (req, res) => {
        pool.query("select id, username, password from web.v_intranet_usuarios where username = '"+ req.body.username + "'", (err, results)=>{
            if(err){
                throw err;
            }

            if (results.rows.length > 0){
                const user = results.rows[0]

                if(req.body.password == user.password){
                    const payload = {
                        username: user.username,
                        id: user.id
                    }

                    const token = jwt.sign(payload, "Random string", { expiresIn: "365d" })

                    return res.status(200).send({
                        success: true,
                        message: "Logged in successfully!",
                        token: "Bearer " + token
                    })
                }else{
                    return res.status(401).send({
                        success: false,
                        message: "Contraseña Incorrecta"
                    })
                }
            } 
            else{
                return res.status(401).send({
                    success: false,
                    message: "Usuario no encontrado"
                })
            } 
        })
    }
)

app.get("/main", passport.authenticate('jwt', { session: false }), (req, res) => {
     return res.status(200).send({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
        }
    })
})

app.get("/perteneceagrupo", passport.authenticate('jwt', { session: false }), async (req, res) => {
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

async function perteneceGrupo(e){
    try{
        const grupos = e.grupousuario.split(',');
        const placeholders = grupos.map((_, index) => `${_}`).join(','); 
        const allDatas = await pool.query(`select * from web.v_intranet_usuarios_grupos where usuario = $1 and grupo in (${placeholders})`, [e.username]);

        if(allDatas.rows.length > 0){
            return true
        }else{
            return false
        }
    } catch (err) {
        return false
    }
}

app.get("/evaluacion", passport.authenticate('jwt', { session: false }), async (req, res) => {
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

/* ELEMENTOS APP REACT */

app.get("/menu-button", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select id, name, link, img_icon, button_color from web.v_intranet_accesos where usuario = $1", [req.user.username]);
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

/* PESTAÑA PRINCIPAL */

app.get("/cumple", async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_cumpleanios limit 8");
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message);
    }
})

app.get("/comunicaciones", async(req, res) => {
    try {
        const allDatas = await pool.query("select fecha::date, asunto, replace(cuerpo,'<img src=''cid:imagen'' />','') cuerpo, imagen as imagen from web.envio_comunicaciones where inicio = true and enviado = true and imagen <> '' order by fecha desc LIMIT 6");
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/bienvenido", passport.authenticate('jwt', { session: false }), async(req, res) => {
    //res.render('main')
        try {
            const allDatas = await pool.query("select * from web.v_intranet_usuario_detallado where usuario = $1", [req.user.username]);
            res.json(allDatas.rows)
        } catch (err) {
            console.log(err.message)
        }
})

app.get("/usuario", passport.authenticate('jwt', { session: false }), async(req, res) => {
    // res.json({"usuario": req.user.username})
    
    try {
        const allDatas = await pool.query("select usuario, nombre from web.v_intranet_usuario_detallado where usuario = $1", [req.user.username]);
        
        res.json({"usuario": allDatas.rows[0].usuario, "nombre": allDatas.rows[0].nombre})
    } catch (err) {
        console.log(err.message)
    }
    
})

app.get("/capacitaciones", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_capacitaciones where usuario_sistema = $1", [req.user.username]);
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/insumos", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_insumos where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/eventos", async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_eventos where not (dia::int >= 9 and dia::int <= 22 and mes = 'FEB') limit 3")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/tareas-pend-cant", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_cant_pendiente where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/tareas", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_pendientes where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/powerbi-accesos", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from WEB.power_bi_accesos order by nombre")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})


/* EXPLORADOR DE ARCHIVOS */

app.get("/getdir", async(req, res) => {
    
    
    function getDirectoryContents(dirPath) {
        try{
            const items = fs.readdirSync(dirPath);
    
            const result = {
                name: path.basename(dirPath),
                path: dirPath,
                type: 'folder',
                items: [],
            };
            
            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);
            
                if (stats.isDirectory()) {
                    const subdirectoryContents = getDirectoryContents(itemPath);
                    result.items.push(subdirectoryContents);
                } else {
                    result.items.push(
                        {
                            name: item, 
                            path: itemPath,
                            type: 'file',
                        }
                    );
                }
            });
            
            return result;
        } catch (err) {
            console.log(err.message)
        }
      
    }
    
    const targetDirectory = req.query.dir; 
    const directoryContents = getDirectoryContents(targetDirectory);
    
    res.json(directoryContents)
})

app.get("/searchdir", async(req, res) => {
    
    const result = {
        name: path.basename(req.query.dir),
        type: 'folder',
        items: [],
    }

    function getDirectoryContents(dirPath, word) {

        try{
            const items = fs.readdirSync(dirPath);
        
            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);
            
                if (stats.isDirectory()) {
                    const subdirectoryContents = getDirectoryContents(itemPath, word);
                } else {
                    if(item.includes(word)){
                        result.items.push(
                            {
                                name: item, 
                                path: itemPath,
                                type: 'file',
                            }
                        );
                    }
                }
            });
            
            return result;
        } catch (err) {
            console.log(err.message);
        }
      
    }
    
    const targetDirectory = req.query.dir;
    const search = req.query.search; 
    const directoryContents = getDirectoryContents(targetDirectory, search);
    res.json(directoryContents)
})


/* EXAMEN DESEMPEÑO */


//Valida si el usuario tiene permisos para acceder a dicha evaluacion
app.get("/validar-eval", passport.authenticate('jwt', { session: false }), async(req, res) => {
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
app.get("/evaluacion-desempenio-pend", passport.authenticate('jwt', { session: false }), async(req, res) => {
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
app.get("/evaluacion-desempenio-det", passport.authenticate('jwt', { session: false }), async(req, res) => {
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
app.get("/evaluacion-desempenio-completas", passport.authenticate('jwt', { session: false }), async(req, res) => {    
    try {
        const allDatas = await pool.query("select * from web.v_intranet_eval_desemp_completas where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
        //res.json(result)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/evaluacion-desempenio-completas-p", passport.authenticate('jwt', { session: false }), async(req, res) => {    
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
app.get("/evaluacion-desempenio-completas-full", passport.authenticate('jwt', { session: false }), async(req, res) => {    
    try {
        const allDatas = await pool.query("select * from web.v_intranet_eval_desemp_completas")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

//Muestra en detalle las respuestas completadas en una evaluacion en especifico
app.get("/evaluacion-desempenio-completas-res", passport.authenticate('jwt', { session: false }), async(req, res) => {
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
app.post("/enviar-evaluacion", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

app.post("/agregar-puntos-feedback", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try{
        await pool.query("update web.intranet_registro_eval_desemp_feedback set feedback = $2 where registro_id = $1",[req.headers.cuestionario, req.body.feedback])    
    } catch (err) {
        console.log(err);
    }

    res.sendStatus(200)
})

/* REGISTRO ESTUDIOS */

app.get("/estudios-clasificadores", passport.authenticate('jwt', { session: false }), async(req, res) => { 
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

app.post("/enviar-estudios", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        req.body.forEach(async(ele) => {
            await pool.query("insert into web.intranet_registro_estudios (tipo_estudio_id, estudio, progreso_id, usuario) values($1, $2, $3, $4)", [ele.tipoEstudioId, ele.estudio, ele.progresoId, req.user.username])
        });
    } catch (err) {
        console.log(err);
    }
    
    res.sendStatus(200)
});

app.post("/modificar-estudios", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

app.get("/carga-estudios-pendiente", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

app.get("/estudios-cargados", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

/* EMPLEADOS */

app.get("/empleados", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.intranet_registro_estudios where usuario = $1", [req.user.username])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

/* LOCKERS */

app.get("/lockers", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("select * from web.v_intranet_lockers where planta = $1", [req.query.planta])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

/* SECCION DETALLADA DE EMPLEADOS */

app.get("/empleado-detalle", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.v_intranet_empleado_detalle where id = $1", [req.headers.empleado_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get("/legajos-empleados", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

app.get("/empleado-puesto", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT puesto_pdf as puesto FROM web.v_intranet_puestos_empleados where empleado_id = $1",[req.headers.empleado_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get("/empleado-cuestionarios", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.v_intranet_formulario_capacitacion where empleado_id = $1",[req.headers.empleado_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get("/empleado-cuestionarios-detalle", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.v_intranet_formulario_capacitacion where id = $1",[req.headers.cuestionario_id])
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get("/empleado-desempenio", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

app.get("/empleado-genoma", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

app.get("/empleado-cv-datos", passport.authenticate('jwt', { session: false }), async(req, res) => {
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



/* OPENAI - SELECCION DE PERSONAL */

app.get("/requerimiento-personal", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        
        let query = ""
        let params = []

        if(req.headers.requerimiento != undefined){
            //HARDCODEO
            if(req.headers.requerimiento == "453868d4-bba4-45f8-99be-1856ea13903b"){
                query = `
                SELECT  req.id,
                    req.tipo,
                    req.numero,
                    req.nombre,
                    req.puesto,
                    req.gerencia,
                    req.sector,
                    req.detalle,
                    req.fecha,
                    req.estado,
                    emp.id as empleado_id,
                    pers.nombre as empleado,
                    emp.codigo,
                    puesto.nombre AS puesto_empleado,
                    sector.nombre  AS sector_empleado,
                    req_col.notas
                FROM web.v_intranet_requerimiento_personal req
                    LEFT JOIN web.intranet_registros_colaboradores_propuestos req_col ON req_col.requerimiento_personal_id = req.id
                    LEFT JOIN empleado emp ON emp.id = req_col.empleado_id
                    LEFT JOIN sector ON sector.id = emp.sector_id
                    LEFT JOIN personafisica pers ON pers.id = emp.enteasociado_id
                    LEFT JOIN ud_empleado udemp ON emp.boextension_id = udemp.id
                    LEFT JOIN ud_puestoorganigrama puesto ON udemp.puestoorganigrama_id = puesto.id
                    where req.id = '453868d4-bba4-45f8-99be-1856ea13903b'
                ORDER BY req.numero;
                
                `
            }else{
                query = "SELECT * FROM web.v_intranet_requerimiento_personal_colaboradores where id = $1"
                params = [req.headers.requerimiento]
            }
            
            const allDatas = await pool.query(query,params)
            const rows = allDatas.rows;
            const requerimientosMap = {};

            for (const row of rows) {
            const reqId = row.id;

            if (!requerimientosMap[reqId]) {
                // Si el requerimiento no existe en el mapa, lo creamos con los datos principales
                requerimientosMap[reqId] = {
                id: row.id,
                tipo: row.tipo,
                numero: row.numero,
                nombre: row.nombre,
                puesto: row.puesto,
                gerencia: row.gerencia,
                sector: row.sector,
                detalle: row.detalle,
                fecha: row.fecha,
                estado: row.estado,
                notas: JSON.parse(row.notas.replace("{", "[").replace("}", "]")),
                candidatos: []
                };
            }

            // Si la fila tiene un empleado asociado, lo agregamos a candidatos
            if (row.empleado_id) {
                requerimientosMap[reqId].candidatos.push({
                empleado_id: row.empleado_id,
                empleado: row.empleado,
                legajo: row.legajo,
                puesto: row.puesto_empleado,
                sector: row.sector_empleado
                });
            }
            }

            // Convertimos el objeto a un array de requerimientos
            const requerimientos = Object.values(requerimientosMap);

            res.json(requerimientos);
        }else{
            //HARDCODEO
            query = "select id, tipo, numero, nombre, puesto, gerencia, sector, detalle, fecha, estado from web.v_intranet_requerimiento_personal where id = '453868d4-bba4-45f8-99be-1856ea13903b'"
            const allDatas = await pool.query(query,params)
            res.json(allDatas.rows)
        }0

    } catch (err) {
        console.log(err)
    }
})

app.get('/organigrama', passport.authenticate('jwt', { session: false }), async(req, res) => {
  //const { gerencia, format } = req.query;
  const gerencia = await buscaGerencia(req.user.username)
  if (!gerencia) {
    return res.status(400).json({ error: 'No se encontró gerencia para el usuario' });
  }

  try {
    console.log(`[ORGANIGRAMA] Iniciando búsqueda para gerencia: ${gerencia}`);
    
    // Leer el CSV maestro desde el servidor
    const csvPath = path.join(__dirname, '../server/data/organigrama_completo.csv');
    console.log(`[ORGANIGRAMA] Ruta CSV: ${csvPath}`);
    
    if (!fs.existsSync(csvPath)) {
      throw new Error(`Archivo CSV no encontrado en: ${csvPath}`);
    }
    console.log(`[ORGANIGRAMA] Archivo CSV encontrado`);

    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    console.log(`[ORGANIGRAMA] CSV leído, tamaño: ${fileContent.length} bytes`);

    const records = parse(fileContent, {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
  trim: true
});
    console.log(`[ORGANIGRAMA] CSV parseado, ${records.length} registros encontrados`);

    // Filtrar por gerencia
    const filteredData = filterByGerencia(records, gerencia);
    console.log(`[ORGANIGRAMA] Filtro completado, ${filteredData.length} registros retornados`);

    // Si se solicita formato CSV
    // if (format && format.toLowerCase() === 'csv') {
    //   const csv = convertToCSV(filteredData);
    //   res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    //   res.setHeader('Content-Disposition', `attachment; filename="organigrama_${gerencia}.csv"`);
    //   res.send(csv);
    // } else {
    //   res.json(filteredData);
    // }

    // const csv = convertToCSV(filteredData);
    // res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // res.setHeader('Content-Disposition', `attachment; filename="organigrama_${gerencia}.csv"`);
    // res.send(csv);

    res.json(filteredData);

  } catch (err) {
    console.error('[ORGANIGRAMA] ERROR:', err.message);
    console.error('[ORGANIGRAMA] Stack:', err.stack);
    res.status(500).json({ 
      error: 'Error procesando organigrama', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

async function buscaGerencia(id){
    try {
        const result = await pool.query("select g.nombre from empleado e left join gerencia g on g.id = e.gerencia_id left join ud_empleado ude on ude.id = e.boextension_id where ude.usuario_sistema = $1", [id]);
        return result.rows[0]?.nombre || null;
    } catch(err){
        console.log(err)
        return null;
    }
}

function filterByGerencia(records, gerencia) {
  try {
    console.log(`[FILTER] Buscando registros con gerencia: ${gerencia}`);
    
    // Encontrar todos los nodos que pertenecen a esta gerencia
    const gerenciaNodes = records.filter(r => 
      r.gerencia?.trim().toLowerCase() === gerencia.trim().toLowerCase()
    );
    
    console.log(`[FILTER] Encontrados ${gerenciaNodes.length} nodos de gerencia`);
    
    if (gerenciaNodes.length === 0) {
      console.log(`[FILTER] No se encontraron nodos. Gerencias disponibles:`, 
        [...new Set(records.map(r => r.gerencia))].filter(Boolean)
      );
      return [];
    }

    // Crear un mapa de IDs de la gerencia para búsquedas rápidas
    const gerenciaIdSet = new Set(gerenciaNodes.map(r => r.id));
    console.log(`[FILTER] IDs únicos de gerencia: ${gerenciaIdSet.size}`);
    
    // Crear nodo raíz sintético ÚNICO para esta gerencia
    const rootId = `11111111-cb33-4f36-90d7-744c52f64660`;
    const syntheticRoot = {
      '': '0',
      name: `Gerencia ${gerencia}`,
      id: rootId,
      okr: '',
      linkedin: '',
      parentId: '', // SIN parentId - este es el nodo raíz
      positionName: ``,
      actualizado: new Date().toISOString(),
      cantidad_subordinados: gerenciaNodes.length.toString(),
      gerencia: gerencia,
      orden: '0',
      imageUrl: ''
    };
    
    // Comenzar con el nodo raíz sintético
    const result = [syntheticRoot];
    
    // Encontrar todos los nodos de la gerencia que NO tienen parentId en la gerencia
    // (estos serán hijos del raíz sintético)
    const directChildrenOfRoot = gerenciaNodes.filter(node => 
      !node.parentId || !gerenciaIdSet.has(node.parentId)
    );
    console.log(`[FILTER] Nodos directos de la raíz sintética: ${directChildrenOfRoot.length}`);
    
    // BFS/DFS para traer solo descendientes dentro de la gerencia
    const queue = [...directChildrenOfRoot];
const visited = new Set();

while (queue.length > 0) {

  const node = queue.shift();

  // clave única por fila
  const uniqueKey = `${node.id}-${node.name}-${node.positionName}`;

  if (visited.has(uniqueKey)) continue;

  visited.add(uniqueKey);

  const normalizedNode = {
    ...node,

    // generar ID único para evitar colisiones
    id: uniqueKey,

    parentId:
      (!node.parentId || !gerenciaIdSet.has(node.parentId))
        ? rootId
        : gerenciaNodes.find(p => p.id === node.parentId)
            ? `${node.parentId}-${gerenciaNodes.find(p => p.id === node.parentId).name}-${gerenciaNodes.find(p => p.id === node.parentId).positionName}`
            : rootId
  };

  result.push(normalizedNode);

  const children = gerenciaNodes.filter(r =>
    r.parentId === node.id
  );

  children.forEach(child => {
    const childKey = `${child.id}-${child.name}-${child.positionName}`;

    if (!visited.has(childKey)) {
      queue.push(child);
    }
  });
}

    console.log(`[FILTER] Total resultados (incluida raíz sintética): ${result.length}`);

    const normalizedResult = result
    .filter(node =>
        node.id === rootId ||
        node.gerencia?.trim().toLowerCase() === gerencia.trim().toLowerCase()
    )
    .map(node => ({
        ...node,
        parentId:
        node.id === rootId
            ? null
            : (!node.parentId || node.parentId.trim() === '')
            ? rootId
            : node.parentId
    }));

    console.log(
  "[FILTER] NODOS FUERA DE GERENCIA EN RESULT:",
  result.filter(node =>
    node.id !== rootId &&
    node.gerencia?.trim().toLowerCase() !== gerencia.trim().toLowerCase()
  ).map(x => ({
    name: x.name,
    gerencia: x.gerencia,
    id: x.id,
    parentId: x.parentId
  }))
);

    return normalizedResult;
  } catch (err) {
    console.error('[FILTER] ERROR en filterByGerencia:', err.message);
    throw err;
  }
}

app.post("/entrevistador", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const items = [];
        const allDatas = await pool.query("select * from web.v_intranet_puestos_empleados")
        let empleadosPrompt = ""
        let puestoPrompt = ""
        for (const row of allDatas.rows) {
            const textoCompleto = await new Promise((resolve, reject) => {
              let texto = "";
      
              new PdfReader().parseBuffer(row.puesto_pdf, (err, item) => {
                if (err) {
                  console.error(`Error leyendo PDF empleado=${row.empleado}:`, err);
                  return reject(err);
                } else if (!item) {
                  return resolve(texto.trim());
                } else if (item.text) {
                  texto += " " + item.text;
                }
              });
        });

        empleadosPrompt = empleadosPrompt + "Empleado: " + row.empleado + ", descripcion puesto: " + textoCompleto + ";"
        puestoPrompt = req.body.descripcion_puesto

        items.push({
            "nombre": row.empleado,
            "descripcion-puesto": textoCompleto
        });

        }

        console.log(items);
        
        const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        });
        

        //role:system, es el prompt base del motor ia
        //role:user, es el input con la descripcion de puesto vacante y el listado de empleados que lo pueden entrevistar
        
        
        const response = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            {
            "role": "system",
            "content": [
                {
                "type": "input_text",
                "text": "Eres un reclutador profesional de recursos humanos, encargado de la selección de posibles entrevistadores que pertenecen a la empresa que posteriormente entrevistaran a posibles candidatos. El posible candidato se determina a través de que tan similar y compatible es el puesto del empleado en comparación al puesto vacante del cual se entrevistaran los candidatos. Debes elegir la primer mejor opción, y la respuesta debe ser únicamente la de devolver los datos en formato JSON (empleado_id, nombre_entrevistador, legajo_entrevistador, puesto_entrevistador, sector_entrevistador, nombre_puesto_vacante, descripcion_puesto_vacante). Datos a devolver: id del empleado, nombre del empleado que entrevistara al candidato, legajo del entrevistador, nombre del puesto vacante y descripción del mismo."
                }
            ]
            },
            {
            "role": "user",
            "content": [
                {
                "type": "input_text",
                //"text": "Descripción del puesto vacante: programador .net\n\nListado de Colaboradores:\n\nNombre: Matías Ramírez Fecha de Nacimiento: 1991-06-24 Lugar de Residencia: Buenos Aires, CABA DNI: 32.456.789 Perfil: Programador .NET con 6 años de experiencia en desarrollo de APIs REST y aplicaciones empresariales.\nNombre: Carla Benítez Fecha de Nacimiento: 1995-12-11 Lugar de Residencia: Córdoba Capital DNI: 39.001.223 Perfil: Programadora Python, especializada en automatización y análisis de datos con Pandas y Flask.\nNombre: Tomás Herrera Fecha de Nacimiento: 1993-09-02 Lugar de Residencia: Comodoro Rivadavia, Chubut DNI: 34.778.654 Perfil: Programador .NET con experiencia en WPF, Entity Framework y sistemas industriales.\nNombre: Ayelén Morales Fecha de Nacimiento: 1997-04-17 Lugar de Residencia: Santa Fe, Santa Fe DNI: 40.112.875 Perfil: Programadora JavaScript con foco en React, consumo de APIs y diseño de interfaces amigables.\nNombre: Lautaro Castillo Fecha de Nacimiento: 1994-01-30 Lugar de Residencia: San Miguel de Tucumán, Tucumán DNI: 35.986.421 Perfil: Programador Java backend, con conocimientos en Spring Boot y bases de datos PostgreSQL."
                "text": puestoPrompt + ";Listado de colaboradores: " + empleadosPrompt
                }
            ]
            },
        ],
        text: {
            "format": {
            "type": "json_object"
            }
        },
        reasoning: {},
        tools: [],
        temperature: 1,
        max_output_tokens: 2048,
        top_p: 1,
        store: true
        });
    

        res.json(JSON.parse(response.output_text));

    } catch (err) {
        console.log(err)
    }
})

// app.get("/entrevistador-requerimiento", passport.authenticate('jwt', { session: false }), async(req, res) => {
//     try {

//         if(await existeEntrevistadores(req.headers.requerimiento)){
//             res.json({result: "ya existen registros de este requerimiento"});
//         }

//         const items = [];
//         //Obtengo PDF del requerimiento
//         const allDatas = await pool.query("SELECT * FROM web.v_intranet_requerimiento_personal WHERE id = $1", [req.headers.requerimiento])
//         let puestoReqPrompt = "";
//         let texto = "";
//         for (const row of allDatas.rows) {
//             const textoCompleto = await new Promise((resolve, reject) => {
              
      
//               new PdfReader().parseBuffer(row.pdf, (err, item) => {
//                 if (err) {
//                   console.error(`Error leyendo PDF=${row.nombre}:`, err);
//                   return reject(err);
//                 } else if (!item) {
//                   return resolve(texto.trim());
//                 } else if (item.text) {
//                   texto += " " + item.text;
//                 }
//               });
//         });
//         }
//         puestoReqPrompt = "Descripción puesto candidato: " + texto

//         //Compruebo si hay colaboradores previos registrados
        
//         const openai = new OpenAI({
//         apiKey: process.env.OPENAI_API_KEY,
//         });

//         //role:system, es el prompt base del motor ia
//         //role:user, es el input con la descripcion de puesto vacante y el listado de empleados que lo pueden entrevistar
        
        
//         const response = await openai.responses.create({
//         model: "gpt-4.1",
//         input: [
//             {
//             "role": "system",
//             "content": [
//                 {
//                 "type": "input_text",
//                 "text": `
//                     Eres un reclutador profesional de recursos humanos. Tu objetivo es seleccionar hasta 5 entrevistadores, en orden (mejor opción primero), para evaluar candidatos a un puesto vacante.

//                     Paso 0: consulta al vector store
//                     - Realiza una búsqueda semántica en el vector store con la cadena: <nombre_puesto_vacante> y descripción asociada. Usa top_k = 100 para obtener el primer set de resultados (Set A).
//                     - **SEGUNDA BÚSQUEDA OBLIGATORIA:** Lanza además una búsqueda o filtro específico para **todos los empleados con jerarquía == "Gerente"**. Usa top_k = 100 para este filtro (Set B).
//                     - **FUSIÓN:** Combina los resultados de Set A y Set B en el array candidatos_raw, eliminando duplicados. Esto asegura que todos los gerentes estén presentes para su consideración.
//                     - IMPORTANTE: No devuelvas ni consideres personas que no obtuviste en los resultados del vectorstore. Nunca inventes empleados.

//                     Paso 1 — Normalizar y ordenar:
//                     1. Normaliza puesto/jerarquía si es necesario (ej.: "Director" -> "Gerente").
//                     2. Ordena la lista por score descendente.

//                     Paso 2 — Reglas de composición específicas (prioritarias):
//                     - Si el puesto vacante contiene la palabra "Jefe": el conclave **debe** incluir 2 Gerentes + 3 Jefes (si hay menos disponibles, incluir máximo posible y documentar en notas).
//                     - Si el puesto vacante es "Jefaturas clave" (ej.: Mantenimiento, UET): el conclave **debe** incluir 3 Gerentes **y** obligatoriamente a: "Nicolas Krecul", "Bruno Passaglia" y "Jorge Viturro" (si esos nombres aparecen en los resultados del vectorstore).
//                     - Si el puesto vacante es "KAM": el conclave **debe** incluir 3 Gerentes + 2 Jefes.
//                     - Si el puesto vacante contiene la palabra "Gerente" o es "Gerentes": el conclave **debe** incluir 4 Gerentes + "Jorge Viturro" (si aparece en resultados).

//                     Paso 3 — Restricciones transversales (siempre aplicar):
//                     1. **No puede haber dos personas del mismo sector entre los entrevistadores seleccionados.**
//                     2. **No puede seleccionarse a una persona que tenga menor jerarquía y pertenezca al mismo sector del puesto objetivo** (ej.: para "Gerente de Calidad" no incluir a "Jefe de Calidad").
//                     3. Nunca proponer personas que no estén en la lista recibida.
//                     4. Mantén máximo 5 entrevistadores; si las reglas obligan a más, prioriza por score y anota faltantes.

//                     Paso 4 — Proceso de llenado:
//                     1. Reservar slots para nombres obligatorios (p.e. "Nicolas Krecul") si aparecen en los resultados.
//                     2. Cubrir roles obligatorios (p.e. 2 Gerentes) eligiendo los mejores por score respetando unicidad de sector.
//                     3. Rellenar los slots restantes hasta 5 con los mejores candidatos que cumplan las restricciones (sin duplicar sector, respetando jerarquía).
//                     4. Si faltan perfiles obligatorios (p.e. no hay suficientes Gerentes en los resultados), ejecutar los fallbacks del Paso 0 o documentar el faltante en notas.

//                     Paso 5 — Salida (SOLO JSON, sin texto adicional):
//                     - Devuelve exactamente un JSON con estas claves (las comillas y la estructura son obligatorias):

//                     {
//                     "nombre_puesto_vacante": "<string>",
//                     "descripcion_puesto_vacante": "<string>",
//                     "candidatos": [
//                         { "empleado_id": "<string>", "empleado": "<string>", "legajo": "<string>", "puesto": "<string>", "sector": "<string>" },
//                         ...
//                     ],
//                     "notas": [ "<mensaje opcional 1>", "<mensaje opcional 2>" ]
//                     }

//                     - **Reglas de validación final** (antes de devolver):
//                     - candidatos.length ≤ 5.
//                     - Ningún sector se repite en candidatos.
//                     - Recursos Humanos no participa de estas entrevistas.
//                     - Ningún empleado incluido estaba fuera de los resultados del vectorstore.
//                     - Si no se pudo cumplir la regla de composición, agregar en notas qué faltó y por qué (p.e. "No se encontraron suficientes Gerentes en los resultados; se intentó fallback por jerarquía y no hubo coincidencias").
//                     - Agregar en notas la justificación de porque se eligio a cada candidato.

//                     Fin del prompt.


//                 `
//                 }
//             ]
//             },
//             {
//             "role": "user",
//             "content": [
//                 {
//                 "type": "input_text",
//                 "text": "Descripcion de puesto vacante: " + puestoReqPrompt 
//                 }
//             ]
//             },
//             ],
//             text: {
//                 "format": {
//                 "type": "json_object"
//                 }
//             },
//             reasoning: {},
//             tools: [
//                 {
//                 "type": "file_search",
//                 "vector_store_ids": [ process.env.OPENAI_VECTOR_ID ],
//                 "file_search": {
//                     "max_num_results": 100 // top_k
//                 }
//                 }
//             ],
//             temperature: 1,
//             max_output_tokens: 2048,
//             top_p: 1,
//             store: true
//             });

//             const parsedOutput = typeof response.output_text === "string"
//                 ? JSON.parse(response.output_text)
//                 : response.output_text;

//             if (parsedOutput?.candidatos?.length) {
//                 await Promise.all(
//                     parsedOutput.candidatos
//                         .filter(resp => resp.empleado_id && resp.empleado_id !== "vacio")
//                         .map(resp =>
//                             altaEntrevistadores(req.headers.requerimiento, resp.empleado_id, parsedOutput.notas)
//                         )
//                 );
//             }

//             //Consulto a la bd los colaboradores insertados
//             query = "SELECT * FROM web.v_intranet_requerimiento_personal_colaboradores where id = $1"
//             params = [req.headers.requerimiento]
//             const allDatas10 = await pool.query(query,params)
//             const rows = allDatas10.rows;
//             const requerimientosMap = {};

//             for (const row of rows) {
//             const reqId = row.id;

//             if (!requerimientosMap[reqId]) {
//                 // Si el requerimiento no existe en el mapa, lo creamos con los datos principales
//                 requerimientosMap[reqId] = {
//                 id: row.id,
//                 numero: row.numero,
//                 nombre: row.nombre,
//                 puesto: row.puesto,
//                 gerencia: row.gerencia,
//                 sector: row.sector,
//                 detalle: row.detalle,
//                 fecha: row.fecha,
//                 estado: row.estado,
//                 candidatos: []
//                 };
//             }

//             // Si la fila tiene un empleado asociado, lo agregamos a candidatos
//             if (row.empleado_id) {
//                 requerimientosMap[reqId].candidatos.push({
//                 empleado_id: row.empleado_id,
//                 empleado: row.empleado,
//                 legajo: row.legajo,
//                 puesto: row.puesto_empleado,
//                 sector: row.sector_empleado
//                 });
//             }
//             }

//             // Convertimos el objeto a un array de requerimientos
//             const requerimientos = Object.values(requerimientosMap);

//             res.json(requerimientos);

//             //res.json(JSON.parse(response.output_text));

//     } catch (err) {
//         console.log(err)
//     }
// })


app.get("/entrevistador-requerimiento", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {

        if(await existeEntrevistadores(req.headers.requerimiento)){
            res.json({result: "ya existen registros de este requerimiento"});
        }

        const items = [];
        //Obtengo PDF del requerimiento

        const allDatas = await pool.query("SELECT * FROM web.v_intranet_requerimiento_personal WHERE id = $1", [req.headers.requerimiento])
        let puestoReqPrompt = "";
        let texto = "";
        let puestot = "";
        let sector = "";
        for (const row of allDatas.rows) {
            puestot = row.puesto;
            sector = row.sector;
            const textoCompleto = await new Promise((resolve, reject) => {
              
              new PdfReader().parseBuffer(row.pdf, (err, item) => {
                if (err) {
                  console.error(`Error leyendo PDF=${row.nombre}:`, err);
                  return reject(err);
                } else if (!item) {
                  return resolve(texto.trim());
                } else if (item.text) {
                  texto += " " + item.text;
                }
              });
        });
        }
        puestoReqPrompt = "Descripción puesto candidato: " + texto

        const descripcion = puestot.toLowerCase();

        const reglas = {
            esJefe: descripcion.includes("jefe"),
            esGerente: descripcion.includes("gerente")
        };

        const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        });


        const embeddingReq = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texto
        });

        const vectorReq = embeddingReq.data[0].embedding;

        //res.json(candidatos);

        //10 candidatos por busqueda semantica
        let candidatos = await generarBusquedaCandidatos(vectorReq, openai, reglas);

        //role:system, es el prompt base del motor ia
        //role:user, es el input con la descripcion de puesto vacante y el listado de empleados que lo pueden entrevistar
        
        
        const response = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            {
            "role": "system",
            "content": [
                {
                "type": "input_text",
                "text": `
                    Eres un reclutador profesional de recursos humanos. Tu objetivo es seleccionar hasta 5 entrevistadores, en orden (mejor opción primero), para evaluar candidatos a un puesto vacante.

                    Paso 0: consulta al vector store
                    - Realiza una búsqueda semántica en el vector store con la cadena: <nombre_puesto_vacante> y descripción asociada. Usa top_k = 100 para obtener el primer set de resultados (Set A).
                    - **SEGUNDA BÚSQUEDA OBLIGATORIA:** Lanza además una búsqueda o filtro específico para **todos los empleados con jerarquía == "Gerente"**. Usa top_k = 100 para este filtro (Set B).
                    - **FUSIÓN:** Combina los resultados de Set A y Set B en el array candidatos_raw, eliminando duplicados. Esto asegura que todos los gerentes estén presentes para su consideración.
                    - IMPORTANTE: No devuelvas ni consideres personas que no obtuviste en los resultados del vectorstore. Nunca inventes empleados.

                    Paso 1 — Normalizar y ordenar:
                    1. Normaliza puesto/jerarquía si es necesario (ej.: "Director" -> "Gerente").
                    2. Ordena la lista por score descendente.

                    Paso 2 — Reglas de composición específicas (prioritarias):
                    - Si el puesto vacante contiene la palabra "Jefe": el conclave **debe** incluir 2 Gerentes + 3 Jefes (si hay menos disponibles, incluir máximo posible y documentar en notas).
                    - Si el puesto vacante es "Jefaturas clave" (ej.: Mantenimiento, UET): el conclave **debe** incluir 3 Gerentes **y** obligatoriamente a: "Nicolas Krecul", "Bruno Passaglia" y "Jorge Viturro" (si esos nombres aparecen en los resultados del vectorstore).
                    - Si el puesto vacante es "KAM": el conclave **debe** incluir 3 Gerentes + 2 Jefes.
                    - Si el puesto vacante contiene la palabra "Gerente" o es "Gerentes": el conclave **debe** incluir 4 Gerentes + "Jorge Viturro" (si aparece en resultados).

                    Paso 3 — Restricciones transversales (siempre aplicar):
                    1. **No puede haber dos personas del mismo sector entre los entrevistadores seleccionados.**
                    2. **No puede seleccionarse a una persona que tenga menor jerarquía y pertenezca al mismo sector del puesto objetivo** (ej.: para "Gerente de Calidad" no incluir a "Jefe de Calidad").
                    3. Nunca proponer personas que no estén en la lista recibida.
                    4. Mantén máximo 5 entrevistadores; si las reglas obligan a más, prioriza por score y anota faltantes.

                    Paso 4 — Proceso de llenado:
                    1. Reservar slots para nombres obligatorios (p.e. "Nicolas Krecul") si aparecen en los resultados.
                    2. Cubrir roles obligatorios (p.e. 2 Gerentes) eligiendo los mejores por score respetando unicidad de sector.
                    3. Rellenar los slots restantes hasta 5 con los mejores candidatos que cumplan las restricciones (sin duplicar sector, respetando jerarquía).
                    4. Si faltan perfiles obligatorios (p.e. no hay suficientes Gerentes en los resultados), ejecutar los fallbacks del Paso 0 o documentar el faltante en notas.

                    Paso 5 — Salida (SOLO JSON, sin texto adicional):
                    - Devuelve exactamente un JSON con estas claves (las comillas y la estructura son obligatorias):

                    {
                    "nombre_puesto_vacante": "<string>",
                    "descripcion_puesto_vacante": "<string>",
                    "candidatos": [
                        { "empleado_id": "<string>", "empleado": "<string>", "legajo": "<string>", "puesto": "<string>", "sector": "<string>" },
                        ...
                    ],
                    "notas": [ "<mensaje opcional 1>", "<mensaje opcional 2>" ]
                    }

                    - **Reglas de validación final** (antes de devolver):
                    - candidatos.length ≤ 5.
                    - Ningún sector se repite en candidatos.
                    - Recursos Humanos no participa de estas entrevistas.
                    - Ningún empleado incluido estaba fuera de los resultados del vectorstore.
                    - Si no se pudo cumplir la regla de composición, agregar en notas qué faltó y por qué (p.e. "No se encontraron suficientes Gerentes en los resultados; se intentó fallback por jerarquía y no hubo coincidencias").
                    - Agregar en notas la justificación de porque se eligio a cada candidato.

                    Fin del prompt.


                `
                }
            ]
            },
            {
            "role": "user",
            "content": [
                {
                "type": "input_text",
                "text": `
                    Descripcion de puesto vacante:
                    ${puestoReqPrompt}

                    Lista de candidatos disponibles (ordenados por similitud semántica):

                    ${JSON.stringify(candidatos, null, 2)}

                    IMPORTANTE:
                    Solo puedes seleccionar entrevistadores de esta lista.
                    No inventes empleados.
                `
                }
            ]
            },
            ],
            text: {
                "format": {
                "type": "json_object"
                }
            },
            reasoning: {},
            temperature: 0,
            max_output_tokens: 2048,
            top_p: 1,
            store: true
            });

            const parsedOutput = typeof response.output_text === "string"
                ? JSON.parse(response.output_text)
                : response.output_text;

            //console.log(parsedOutput)
            
            //res.json(parsedOutput)

            if (parsedOutput?.candidatos?.length) {
                await Promise.all(
                    parsedOutput.candidatos
                        .filter(resp => resp.empleado_id && resp.empleado_id !== "vacio")
                        .map(resp =>
                            altaEntrevistadores(req.headers.requerimiento, resp.empleado_id, parsedOutput.notas)
                        )
                );
            }
            
            //Consulto a la bd los colaboradores insertados

            let query = ""
            let params = []
            
            query = "SELECT * FROM web.v_intranet_requerimiento_personal_colaboradores where id = $1"
            params = [req.headers.requerimiento]
            
            const allDatas10 = await pool.query(query,params)
            const rows = allDatas10.rows;
            const requerimientosMap = {};

            for (const row of rows) {
            const reqId = row.id;

            if (!requerimientosMap[reqId]) {
                // Si el requerimiento no existe en el mapa, lo creamos con los datos principales
                requerimientosMap[reqId] = {
                id: row.id,
                numero: row.numero,
                nombre: row.nombre,
                puesto: row.puesto,
                gerencia: row.gerencia,
                sector: row.sector,
                detalle: row.detalle,
                fecha: row.fecha,
                estado: row.estado,
                candidatos: []
                };
            }

            // Si la fila tiene un empleado asociado, lo agregamos a candidatos
            if (row.empleado_id) {
                requerimientosMap[reqId].candidatos.push({
                empleado_id: row.empleado_id,
                empleado: row.empleado,
                legajo: row.legajo,
                puesto: row.puesto_empleado,
                sector: row.sector_empleado
                });
            }
            }

            // Convertimos el objeto a un array de requerimientos
            const requerimientos = Object.values(requerimientosMap);

            res.json(requerimientos);
            
            res.json(JSON.parse(response.output_text));

    } catch (err) {
        console.log(err)
    }
})

async function generarBusquedaCandidatos(vectorReq, openai, reglas){

    const resultPg = await pool.query(
        "SELECT * FROM web.v_intranet_puestos_empleados"
    );

    const candidatos = [];

    for (const row of resultPg.rows) {

        const texto = await parsePdfBuffer(row.puesto_pdf);

        const emb = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: texto
        });

        const vectorEmp = emb.data[0].embedding;

        const score = cosineSimilarity(vectorReq, vectorEmp);

        candidatos.push({
            empleado_id: row.empleado_id,
            empleado: row.empleado,
            puesto: row.puesto,
            legajo: row.legajo,
            sector: row.sector,
            jerarquia: detectarJerarquia(row.puesto),
            puesto_pdf_texto: texto.substring(0,1500),
            score
        });
    }

    candidatos.sort((a,b)=> b.score - a.score);

    if(reglas.esJefe || reglas.esGerente){
        console.log("Es jefe / gerente")
        candidatos.sort((a,b)=> b.jerarquia - a.jerarquia);
    }

    return candidatos.slice(0,15);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function detectarJerarquia(puesto){

    const p = puesto.toLowerCase();

    if(p.includes("gerente")) return 2;
    if(p.includes("jefe")) return 1;

    return 0;
}


/* PLAN DE CAPACITACION CON IA */

app.get("/plan-capacitacion", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if(req.headers.empleado_id == null){
            return res.status(500).json({
                error: "No se encuentra empleado id",
            });
        }

        const allDatas = await pool.query(`select * from web.v_intranet_registro_plan_capacitacion where empleado_id = $1 limit 1`, [req.headers.empleado_id]);                
        if (allDatas.rows.length > 0) {
            const data = allDatas.rows[0];

            try {
                data.propuesta = JSON.parse(data.propuesta);
            } catch (err) {
                console.warn("No se pudo parsear 'propuesta':", err.message);
            }

            res.json(data);
        } else {
            res.json({});
        }

    } catch (err) {
        console.log(err)
    }
})

app.get("/obtener-plan-capacitacion", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if(req.headers.empleado_id == null){
            return res.status(500).json({
                error: "No se encuentra empleado id",
            });
        }

        const empleado_id = req.headers.empleado_id

        if(await existePlanCapacitacion(empleado_id)){
            try{
                return res.status(500).json({
                    error: "No se encuentra empleado id",
                });
            }catch(err){
                console.log(err)
            }
        }else{

        const resultPg = await pool.query("SELECT * FROM web.v_intranet_plan_capacitacion_empleados where empleado_id = $1", [req.headers.empleado_id]);

        if (resultPg.rows.length === 0) {
            return res.status(404).json({ error: "Empleado no encontrado" });
        }

        const row = resultPg.rows[0];
        const texto = await parsePdfBuffer(row.puesto_pdf);


        const empleado = {
                empleado_id: row.empleado_id,
                empleado: row.empleado,
                puesto: row.puesto,
                legajo: row.legajo,
                sector: row.sector,
                puesto_pdf: texto,
                cuestionario_capacitacion: {
                conocimiento_mision_vision_valores: row.conocimiento_mision_vision_valores,
                conocimiento_politica_calidad: row.conocimiento_politica_calidad,
                conocimiento_politica_seguridad: row.conocimiento_politica_seguridad,
                conocimiento_normas_convivencia: row.conocimiento_normas_convivencia,
                habilidades_suficientes: row.habilidades_suficientes,
                necesidades_capacitacion: row.necesidades_capacitacion,
                tipo_formacion_preferida: row.tipo_formacion_preferida,
                barreras_capacitacion: row.barreras_capacitacion,
                temas_especificos: row.temas_especificos,
                impacto_capacitacion_desempeno: row.impacto_capacitacion_desempeno
                },
                evaluacion_desempenio: {
                fecha: row.fecha_desempenio,
                resultados: []
                }
        };

        resultPg.rows.forEach(row => {
            empleado.evaluacion_desempenio.resultados.push({
            pregunta: row.pregunta_desempenio,
            respuesta: row.respuesta_desempenio,
            puntuacion: row.puntuacion_desempenio,
            feedback: row.feedback_desempenio
        });
        })
        
        console.log(empleado)
        
        const openai = new OpenAI({
        apiKey: process.env.OPENAI_CAP_API_KEY,
        });

        //role:system, es el prompt base del motor ia
        //role:user, es el input con la descripcion de puesto vacante y el listado de empleados que lo pueden entrevistar        
        
        const response = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            {
            "role": "system",
            "content": [
                {
                "type": "input_text",
                "text": `

                Rol: Eres un Agente de Capacitación, un experto en desarrollo de talento y diseño instruccional. Tu tarea es analizar información de un empleado y crear un plan de capacitación individualizado y efectivo.

                Objetivo: Desarrollar un plan de capacitación integral para un colaborador, identificando brechas de habilidades y diseñando acciones de aprendizaje que lo preparen para alcanzar los objetivos de su puesto.

                Instrucciones y Datos de Entrada:

                A continuación se te proporcionará la siguiente información:

                Descripción del Puesto: Un documento detallado con las responsabilidades, objetivos, habilidades clave y competencias requeridas para el rol del colaborador.

                Resultados de la Evaluación de Desempeño: Un informe con los resultados de su última revisión. Incluye fortalezas destacadas, áreas de mejora y el rendimiento general con respecto a las expectativas del puesto.

                Cuestionario de Detección de Necesidades de Capacitación: Las respuestas directas del colaborador. Esto puede incluir habilidades en las que siente que necesita mejorar, herramientas o tecnologías que le gustaría aprender y sus metas de desarrollo profesional a corto y largo plazo.

                Proceso de Análisis:

                Análisis de Brechas:

                Compara la Descripción del Puesto con los Resultados de la Evaluación de Desempeño. Identifica las brechas entre las habilidades requeridas y el rendimiento actual del empleado.

                Cruza esta información con las respuestas del Cuestionario de Detección de Necesidades. ¿Hay coincidencias entre lo que el empleado percibe como una necesidad y lo que la evaluación de desempeño revela?

                Identifica las brechas clave que son críticas para el éxito en el puesto actual y aquellas que apoyan el crecimiento profesional del colaborador.

                Diseño del Plan de Capacitación:

                Crea una tabla con las siguientes columnas:

                Área de Mejora/Habilidad a Desarrollar: Nombra la habilidad específica o el conocimiento que se debe fortalecer.

                Brecha Identificada: Explica brevemente por qué esta área es una prioridad, haciendo referencia a la descripción del puesto, la evaluación de desempeño o el cuestionario.

                Objetivo de Capacitación: Define un objetivo claro, medible y específico (formato SMART) para cada área. Por ejemplo: "Al finalizar el curso, el colaborador será capaz de utilizar [herramienta] para [tarea específica] y reducir el tiempo de ejecución en un 15%".

                Acciones de Capacitación Recomendadas: Propón al menos 2-3 acciones concretas y variadas para cada objetivo. Las opciones pueden incluir cursos en línea, talleres, mentorías, asignaciones de proyectos especiales, shadowing, certificaciones, o lectura de material especializado.

                Capacitacion Sugerida: Recomienda curso que puede ser seleccionado para complementar el plan de capacitación, este tiene que surgir de la siguiente lista:

                Instituciones donde consultar cursos:
                    - Udemy (https://www.udemy.com/)
                    - UTN e learning (https://sceu.frba.utn.edu.ar/e-learning/)
                    - Educacion IT (https://www.educacionit.com/)
                    - AACAM (https://aacam.com.ar/formacion-y-capacitacion/)
                    - Signica (https://signica.com.ar/herramientas/)
                    - Axenfeld (https://estudioaxenfeld.com.ar/cursos-por-area/)
                    - Propyme (https://www.programapropymes.com/capacitacion)
                    - Setec (https://setec.com.ar/)
                    - Dinalia (https://dinalia.com/)
                    - SKF (https://iberian.promo.skf.com/acton/fs/blocks/showLandingPage/a/25049/p/p-034d/t/page/fm/4)
                    - Tecpeople (https://tecpeople.com/)
                    - IRAM (https://iram.org.ar/)
                    - Capacitarte UBA (https://www.capacitarte.org/)
                    - Came Escuela de Negocios (https://escuela-negocios-came.com.ar/)
                    - Ansim (https://www.consultoraansim.com/#!/-cursos-y-capacitaciones-2/)
                    - X-plan (https://www.x-plan.com/capacitacion/)
                    - SPE (https://www.spe.org.ar/)
                    - Samsa (https://samsaconsultores.com/servicios/)

                Recomendá cursos de páginas oficiales.
 
                Para cada curso:
                - Proporcioná el ENLACE DIRECTO más específico disponible al curso.
                - Si el enlace puede cambiar o la inscripción está cerrada, igualmente incluí el link y aclaralo.
                - NO reemplaces el enlace del curso por la página principal del sitio.
                - Si no existe un enlace directo público, indicá explícitamente: "No hay enlace directo público".
                
                Formato obligatorio de salida:
                - Nombre del curso
                - Institución
                - URL directa del curso
                - Estado del enlace (activo / inscripción cerrada / puede cambiar)

                Formato de Salida:

                Comienza con un resumen ejecutivo que presente las principales conclusiones del análisis.

                Luego, presenta el plan de capacitación en la tabla detallada.

                Finaliza con un párrafo de recomendaciones adicionales y un mensaje motivacional para el colaborador, destacando la importancia de este plan para su crecimiento profesional.

                Devuelve la información en formato JSON válido

                Formato JSON:

                {
                "resumen_ejecutivo": "string",
                "plan_capacitacion": [
                    {
                    "area_mejora": "string",
                    "brecha_identificada": "string",
                    "objetivo_capacitacion": "string",
                    "acciones_recomendadas": "Array<string>",
                    "recursos_sugeridos": "string",
                    "capacitacion_sugerida": "string",
                    "link_capacitacion_sugerida": "string"
                    }
                ],
                "recomendaciones_finales": "string"
                }

                Regla crítica:
                Si no podés encontrar un enlace directo verificable desde el sitio oficial,
                NO inventes un curso ni generes una URL.
                En ese caso devuelve:
                - capacitacion_sugerida: "No se encontró curso con enlace directo verificable"
                - link_capacitacion_sugerida: null


                `
                }
            ]
            },
            {
            "role": "user",
            "content": [
                {
                "type": "input_text",
                "text": `
                    Empleado id a analizar: ${empleado_id}

                    Datos completos del empleado (JSON):
                    ${JSON.stringify(empleado, null, 2)}
                `
                }
            ]
            },
            ],
            text: {
                "format": {
                // "type": "json_object"
                "type": "text"
                }
            },
            reasoning: {},
            tools: [
                {
                "type": "web_search",
                }
            ],
            tool_choice: { type: "web_search" },
            temperature: 0,
            max_output_tokens: 2048,
            top_p: 1,
            store: true
            });

            // const parsedOutput = typeof response.output_text === "string"
            //     ? JSON.parse(response.output_text)
            //     : response.output_text;

            //const raw = response.output[0].content[0].text;
            //const parsedOutput = JSON.parse(raw);
            const raw = response.output_text;

            //altaPlanCapacitacion(parsedOutput, empleado_id)

            //res.json(parsedOutput);
            

        const openaiJSON = new OpenAI({
        apiKey: process.env.OPENAI_CAP_API_KEY,
        });

        //role:system, es el prompt base del motor ia
        //role:user, es el input con la descripcion de puesto vacante y el listado de empleados que lo pueden entrevistar        
        
        const responseJSON = await openaiJSON.responses.create({
        model: "gpt-4.1",
        input: [
            {
            "role": "system",
            "content": [
                {
                "type": "input_text",
                "text": `
                
                Devuelve la información en formato JSON válido

                Formato JSON:

                {
                "resumen_ejecutivo": "string",
                "plan_capacitacion": [
                    {
                    "area_mejora": "string",
                    "brecha_identificada": "string",
                    "objetivo_capacitacion": "string",
                    "acciones_recomendadas": "Array<string>",
                    "recursos_sugeridos": "string",
                    "capacitacion_sugerida": "string",
                    "link_capacitacion_sugerida": "string"
                    }
                ],
                "recomendaciones_finales": "string"
                }
                
                `
                }
            ]
            },
            {
            "role": "user",
            "content": [
                {
                "type": "input_text",
                "text": `
                    Texto a pasar a JSON: ${raw}
                `
                }
            ]
            },
            ],
            text: {
                "format": {
                // "type": "json_object"
                "type": "text"
                }
            },
            reasoning: {},
            temperature: 1,
            max_output_tokens: 2048,
            top_p: 1,
            store: true
            });

            const rawjson = responseJSON.output_text;
            const parsedOutputJSON = JSON.parse(rawjson);

            altaPlanCapacitacion(parsedOutputJSON, empleado_id)

            res.json(parsedOutputJSON);
    }
    } catch (err) {
        console.log(err)
    }
})


function parsePdfBuffer(buffer) {
  return new Promise((resolve, reject) => {
    let text = "";
    const reader = new PdfReader();

    reader.parseBuffer(buffer, (err, item) => {
      if (err) {
        reject(err);
      } else if (!item) {
        // Fin del documento
        resolve(text.trim());
      } else if (item.text) {
        text += " " + item.text;
      }
    });
  });
}

// Ruta principal
app.post("/enviar-data-storage-conclave", async (req, res) => {
  try {
    const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
    });

    const resultPg = await pool.query("SELECT * FROM web.v_intranet_puestos_empleados");
    const empleados = [];

    for (const row of resultPg.rows) {
      const texto = await parsePdfBuffer(row.puesto_pdf);
      const especificaciones = extraerSeccionPuesto(texto);
      //const textoLimpio = limpiarTextoOCR(texto);
      empleados.push({
        empleado_id: row.empleado_id,
        empleado: row.empleado,
        puesto: row.puesto,
        legajo: row.legajo,
        sector: row.sector,
        puesto_pdf: especificaciones || "No se encontraron especificaciones del puesto",
      });
    }
    
    // Guardar archivo JSON
    const filePath = path.join(__dirname, "files", "empleados.json");
    fs.writeFileSync(filePath, JSON.stringify(empleados, null, 2));

    // Subir a OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    });

    // Agregar al vector store
    const vectorStoreId = process.env.OPENAI_VECTOR_ID;
    let result;
    try {
        result = await openai.vectorStores.files.create(vectorStoreId, {file_id: file.id,});
    } catch (err) {
        console.error("Error agregando archivo al vector store:", err);
        return res.status(500).json({
            error: "No se pudo agregar el archivo al vector store.",
            details: err?.response?.data || err.message || err,
        });
    }

    res.json({
      message: "Archivo subido y agregado al vector store.",
      file_id: file.id,
      vector_store_result: result,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error procesando la carga al vector store." });
  }
});

function extraerSeccionPuesto(textoCompleto) {
  if (!textoCompleto) return null;

  //Normalizamos el texto: eliminamos saltos de línea y espacios múltiples
  const texto = textoCompleto
    .replace(/\r?\n|\r/g, " ")        // quita saltos de línea
    .replace(/\s{2,}/g, " ")          // compacta espacios
    .replace(/\u0000/g, "")           // elimina caracteres nulos (a veces aparecen en OCR)
    .trim();

  //Definimos los patrones de búsqueda
  const patrones = [
    // ESPECIFICACIONES → REQUISITOS/REQUERIMIENTOS
    [
      /(?:\d+\.\s*)?ESPECIFICACI(?:Ó|O)NES?\s+DEL\s+(?:PUESTO|CARGO)/i,
      /(?:\d+\.\s*)?(?:REQUISITOS?|REQUERIMIENTOS?)\s+DEL\s+(?:PUESTO|CARGO)/i
    ],
    // FUNCIONES BÁSICAS → REQUISITOS/REQUERIMIENTOS
    [
      /(?:\d+\.\s*)?FUNCIONES?\s+BÁSICAS/i,
      /(?:\d+\.\s*)?(?:REQUERIMIENTOS?|REQUISITOS?)\s+DEL\s+(?:PUESTO|CARGO)/i
    ]
  ];

  //Intentamos cada patrón
  for (const [inicioRegex, finRegex] of patrones) {
    const inicio = texto.search(inicioRegex);
    const fin = texto.search(finRegex);

    if (inicio !== -1 && fin !== -1 && fin > inicio) {
      const subtexto = texto
        .slice(inicio, fin)
        .replace(inicioRegex, "") // elimina título inicial
        .trim();
      console.log(`Sección detectada con patrón: ${inicioRegex}`);
      return subtexto;
    }
  }

  console.warn("Ningún patrón coincidió en este PDF");
  return null;
}


// function limpiarTextoOCR(texto) {
//   if (!texto) return "";

//   return texto
//     .normalize("NFKC")
//     .replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ])\s+([A-Za-zÁÉÍÓÚÑáéíóúñ])/g, "$1$2")
//     .replace(/\s+/g, " ")
//     .replace(/[\u200B-\u200D\uFEFF]/g, "")
//     .replace(/\s+([.,;:!?])/g, "$1")
//     .replace(/([A-Z])\s+([A-Z])/g, "$1$2")
//     .replace(/([A-ZÁÉÍÓÚÑ])\s+([A-ZÁÉÍÓÚÑ])/g, "$1$2")
//     .trim();
// }

// Ruta principal
app.post("/enviar-data-storage-capacitacion", async (req, res) => {
  try {
    const openai = new OpenAI({
            apiKey: process.env.OPENAI_CAP_API_KEY,
    });

    const resultPg = await pool.query("SELECT * FROM web.v_intranet_plan_capacitacion_empleados");

    const empleadosMap = new Map();

    for (const row of resultPg.rows) {
    // resultPg.rows.forEach(row => {
        if (!empleadosMap.has(row.empleado_id)) {
        const texto = await parsePdfBuffer(row.puesto_pdf);    
        empleadosMap.set(row.empleado_id, {
            empleado_id: row.empleado_id,
            empleado: row.empleado,
            puesto: row.puesto,
            legajo: row.legajo,
            sector: row.sector,
            puesto_pdf: texto,
            cuestionario_capacitacion: {
            conocimiento_mision_vision_valores: row.conocimiento_mision_vision_valores,
            conocimiento_politica_calidad: row.conocimiento_politica_calidad,
            conocimiento_politica_seguridad: row.conocimiento_politica_seguridad,
            conocimiento_normas_convivencia: row.conocimiento_normas_convivencia,
            habilidades_suficientes: row.habilidades_suficientes,
            necesidades_capacitacion: row.necesidades_capacitacion,
            tipo_formacion_preferida: row.tipo_formacion_preferida,
            barreras_capacitacion: row.barreras_capacitacion,
            temas_especificos: row.temas_especificos,
            impacto_capacitacion_desempeno: row.impacto_capacitacion_desempeno
            },
            evaluacion_desempenio: {
            fecha: row.fecha_desempenio,
            resultados: []
            }
        });
        }

        // Agregar el resultado de desempeño
        empleadosMap.get(row.empleado_id).evaluacion_desempenio.resultados.push({
        pregunta: row.pregunta_desempenio,
        respuesta: row.respuesta_desempenio,
        puntuacion: row.puntuacion_desempenio,
        feedback: row.feedback_desempenio
        });
    }

    //res.json(Array.from(empleadosMap.values()))

    // Guardar archivo JSON
    const filePath = path.join(__dirname, "files", "empleados-cap.json");
    fs.writeFileSync(
    filePath,
    JSON.stringify(Array.from(empleadosMap.values()), null, 2),
    "utf8"
    );

    
    // Subir a OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    });

    // Agregar al vector store
    const vectorStoreId = process.env.OPENAI_CAP_VECTOR_ID;
    let result;
    try {
        result = await openai.vectorStores.files.create(vectorStoreId, {file_id: file.id,});
    } catch (err) {
        console.error("Error agregando archivo al vector store:", err);
        return res.status(500).json({
            error: "No se pudo agregar el archivo al vector store.",
            details: err?.response?.data || err.message || err,
        });
    }

    res.json({
      message: "Archivo subido y agregado al vector store.",
      file_id: file.id,
      vector_store_result: result,
    });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Error procesando la carga al vector store." });
  }
});

async function existeEntrevistadores(requerimiento){
    try{
        const allDatas = await pool.query(`select * from web.intranet_registros_colaboradores_propuestos where requerimiento_personal_id = $1 and empleado_id IS NOT NULL`, [requerimiento]);
        console.log(allDatas)
        if(allDatas.rows.length > 0){
            return true
        }else{
            return false
        }
    }catch(err){
        console.log(err)
    }
}

async function altaEntrevistadores(requerimiento, empleado, notas){
    try {
        await pool.query("insert into web.intranet_registros_colaboradores_propuestos (requerimiento_personal_id , empleado_id, notas) values($1, $2, $3)", [requerimiento, empleado, notas])
    } catch(err){
        console.log("Error insertando entrevistador:", err);
        throw err;
    }
}

async function eliminarEntrevistadoresPrevios(requerimiento, empleado){
    try {
        await pool.query("delete from web.intranet_registros_colaboradores_propuestos where requerimiento_personal_id = $1", [requerimiento])
    } catch(err){
        console.log(err)
    }
}

async function altaPlanCapacitacion(plan, empleado){
    try {
        await pool.query("insert into web.intranet_registros_plan_capacitacion (propuesta , empleado_id) values($1, $2)", [plan, empleado])
    } catch(err){
        res.status(500).json({ error: "Error procesando el archivo o conectando con OpenAI." });
        console.log(err)
    }
}

async function existePlanCapacitacion(empleado_id){
    try{
        const allDatas = await pool.query(`select * from web.intranet_registros_plan_capacitacion where empleado_id = $1`, [empleado_id]);
        console.log(allDatas)
        if(allDatas.rows.length > 0){
            return true
        }else{
            return false
        }
    }catch(err){
        console.log(err)
    }
}

/* Carga Objetivos Gerencias */

app.get("/objetivos-gerencias", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const allDatas = await pool.query("SELECT * FROM web.intranet_objetivo_gerencia")
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err)
    }
})

app.put("/gerencias/:id", passport.authenticate('jwt', { session: false }), async(req, res) => {
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

/* OBJETIVOS ANUALES */

async function requireAdminObjetivos(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: "'Direccion','administradores','rrhh'" });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para Dirección/administradores/RRHH" });
        return false;
    }
    return true;
}

// Las siguientes 4 funciones deben reflejar exactamente la misma lógica que
// components/Modules/ObjetivosAnuales/utils.js en el frontend, para que el puntaje que
// se ve en vivo mientras se carga un resultado coincida con el que persiste el backend.

function parsearResultado(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = parseFloat(String(raw).replace(',', '.').replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
}

// Nota: umbral_score1 ("No alcanza") se guarda y se puede editar como los demás umbrales,
// pero no participa de esta cuenta — el puntaje 1 sigue siendo el resultado por defecto
// cuando el resultado no alcanza el umbral del puntaje 2. Queda como referencia visual/de
// carga para el evaluador (ej. el piso esperado del pilar).
function calcularPuntajePilarObjetivo(pilar, resultadoReal) {
    const val = parsearResultado(resultadoReal);
    if (val === null) return null;
    const alcanza = pilar.direccion === 'lower'
        ? (v, umbral) => v <= umbral
        : (v, umbral) => v >= umbral;
    if (alcanza(val, Number(pilar.umbral_score5))) return 5;
    if (alcanza(val, Number(pilar.umbral_score4))) return 4;
    if (alcanza(val, Number(pilar.umbral_score3))) return 3;
    if (alcanza(val, Number(pilar.umbral_score2))) return 2;
    return 1;
}

function calcularPuntajeFinalObjetivos(pilares) {
    const anyScored = pilares.some(p => p.puntaje !== null && p.puntaje !== undefined);
    const completo = pilares.length > 0 && pilares.every(p => p.puntaje !== null && p.puntaje !== undefined);
    if (!anyScored) return { puntajeFinal: null, completo };
    const weightedSum = pilares.reduce((acc, p) => acc + (Number(p.puntaje) || 0) * Number(p.peso), 0);
    return { puntajeFinal: Number((weightedSum / 100).toFixed(2)), completo };
}

function pesosPilaresValidos(pilares) {
    const suma = pilares.reduce((acc, p) => acc + Number(p.peso || 0), 0);
    return Math.abs(suma - 100) < 0.01;
}

// Cada pilar debe pesar entre PESO_MIN y PESO_MAX %, y un registro debe tener entre
// PILARES_MIN y PILARES_MAX pilares (debe reflejar exactamente lo mismo que
// components/Modules/ObjetivosAnuales/constants.js y utils.js en el frontend).
const PESO_MIN_PILAR = 10;
const PESO_MAX_PILAR = 40;
const PILARES_MIN = 3;
const PILARES_MAX = 5;

function pesoPilarValido(peso) {
    const n = Number(peso);
    return Number.isFinite(n) && n >= PESO_MIN_PILAR && n <= PESO_MAX_PILAR;
}

function todosLosPesosEnRango(pilares) {
    return pilares.every(p => pesoPilarValido(p.peso));
}

function cantidadPilaresValida(pilares) {
    return pilares.length >= PILARES_MIN && pilares.length <= PILARES_MAX;
}

const OBJETIVO_ANUAL_SELECT = `
    SELECT
        r.*,
        pers.nombre AS empleado_nombre,
        s.nombre AS area,
        g.nombre AS gerencia
    FROM web.registro_objetivo_anual r
    LEFT JOIN empleado emp ON emp.id = r.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
`;

// GET: listado de registros — admin ve todos, el resto sólo el propio y publicado
app.get("/objetivos-anuales", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const username = req.user.username;
        const esAdmin = await perteneceGrupo({ username, grupousuario: "'Direccion','administradores','rrhh'" });

        if (esAdmin) {
            const allDatas = await pool.query(`${OBJETIVO_ANUAL_SELECT} ORDER BY r.anio DESC, pers.nombre ASC`);
            return res.json({ es_admin: true, registros: allDatas.rows });
        }

        const infoUsuario = await obtenerGerenciaDelUsuario(username);
        if (!infoUsuario || !infoUsuario.empleado_id) {
            return res.json({ es_admin: false, registros: [] });
        }

        const allDatas = await pool.query(
            `${OBJETIVO_ANUAL_SELECT} WHERE r.empleado_id = $1 AND r.estado = 'publicado' ORDER BY r.anio DESC`,
            [infoUsuario.empleado_id]
        );
        res.json({ es_admin: false, registros: allDatas.rows });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo los objetivos anuales" });
    }
});

// GET: detalle de un registro + sus pilares
app.get("/objetivos-anuales/:id", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;

        const registroData = await pool.query(`${OBJETIVO_ANUAL_SELECT} WHERE r.id = $1`, [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        const esAdmin = await perteneceGrupo({ username, grupousuario: "'Direccion','administradores','rrhh'" });
        if (!esAdmin) {
            const infoUsuario = await obtenerGerenciaDelUsuario(username);
            const esPropio = infoUsuario && infoUsuario.empleado_id === registro.empleado_id;
            if (!esPropio || registro.estado !== 'publicado') {
                return res.status(403).json({ error: "No tenés acceso a este registro" });
            }
        }

        const pilaresData = await pool.query(
            "SELECT * FROM web.objetivo_anual_pilar WHERE registro_id = $1 ORDER BY orden ASC",
            [registroId]
        );

        res.json({ registro, pilares: pilaresData.rows, puede_editar: esAdmin });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo el registro" });
    }
});

// POST: crear un registro (ciclo anual de un empleado) con sus pilares, en borrador
app.post("/objetivos-anuales", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const { empleado_id, anio, evaluador, pilares } = req.body;
        const username = req.user.username;

        if (!empleado_id || !anio) {
            return res.status(400).json({ error: "empleado_id y anio son requeridos" });
        }
        if (!Array.isArray(pilares) || pilares.length === 0) {
            return res.status(400).json({ error: "Debe cargar al menos un pilar" });
        }
        if (!cantidadPilaresValida(pilares)) {
            return res.status(400).json({ error: `Un registro debe tener entre ${PILARES_MIN} y ${PILARES_MAX} pilares` });
        }
        if (!todosLosPesosEnRango(pilares)) {
            return res.status(400).json({ error: `Cada pilar debe pesar entre ${PESO_MIN_PILAR}% y ${PESO_MAX_PILAR}%` });
        }
        if (!pesosPilaresValidos(pilares)) {
            return res.status(400).json({ error: "La suma de los pesos de los pilares debe ser 100" });
        }

        const empleadoData = await pool.query(`
            SELECT puesto.nombre AS puesto
            FROM empleado emp
            LEFT JOIN ud_empleado ude ON ude.id = emp.boextension_id
            LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
            WHERE emp.id = $1
        `, [empleado_id]);
        const puestoSnapshot = empleadoData.rows[0] ? empleadoData.rows[0].puesto : null;

        const registroId = require('crypto').randomUUID();
        let registroResult;
        try {
            registroResult = await pool.query(
                `INSERT INTO web.registro_objetivo_anual
                 (id, empleado_id, anio, puesto_snapshot, evaluador, estado, creado_por, fecha_creacion)
                 VALUES ($1, $2, $3, $4, $5, 'borrador', $6, NOW()) RETURNING *`,
                [registroId, empleado_id, anio, puestoSnapshot, evaluador || null, username]
            );
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: "Ya existe un registro de objetivos anuales para ese empleado en ese año" });
            }
            throw err;
        }

        const pilaresInsertados = [];
        for (let i = 0; i < pilares.length; i++) {
            const p = pilares[i];
            const pilarResult = await pool.query(
                `INSERT INTO web.objetivo_anual_pilar
                 (id, registro_id, orden, nombre, descripcion, peso, unidad, direccion,
                  umbral_score1, umbral_score2, umbral_score3, umbral_score4, umbral_score5)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
                [
                    require('crypto').randomUUID(), registroId, i,
                    p.nombre, p.descripcion || null, p.peso, p.unidad || null, p.direccion,
                    p.umbral_score1, p.umbral_score2, p.umbral_score3, p.umbral_score4, p.umbral_score5
                ]
            );
            pilaresInsertados.push(pilarResult.rows[0]);
        }

        res.status(201).json({ registro: registroResult.rows[0], pilares: pilaresInsertados });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando el registro de objetivos anuales" });
    }
});

// PUT: reemplazar la definición de pilares de un registro (sólo mientras está en borrador)
app.put("/objetivos-anuales/:id/pilares", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const { pilares } = req.body;

        if (!Array.isArray(pilares) || pilares.length === 0) {
            return res.status(400).json({ error: "Debe cargar al menos un pilar" });
        }
        if (!cantidadPilaresValida(pilares)) {
            return res.status(400).json({ error: `Un registro debe tener entre ${PILARES_MIN} y ${PILARES_MAX} pilares` });
        }
        if (!todosLosPesosEnRango(pilares)) {
            return res.status(400).json({ error: `Cada pilar debe pesar entre ${PESO_MIN_PILAR}% y ${PESO_MAX_PILAR}%` });
        }
        if (!pesosPilaresValidos(pilares)) {
            return res.status(400).json({ error: "La suma de los pesos de los pilares debe ser 100" });
        }

        const registroData = await pool.query("SELECT * FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        if (registroData.rows[0].estado !== 'borrador') {
            return res.status(400).json({ error: "Sólo se pueden editar los pilares de un registro en borrador" });
        }

        await pool.query("DELETE FROM web.objetivo_anual_pilar WHERE registro_id = $1", [registroId]);

        const pilaresInsertados = [];
        for (let i = 0; i < pilares.length; i++) {
            const p = pilares[i];
            const pilarResult = await pool.query(
                `INSERT INTO web.objetivo_anual_pilar
                 (id, registro_id, orden, nombre, descripcion, peso, unidad, direccion,
                  umbral_score1, umbral_score2, umbral_score3, umbral_score4, umbral_score5)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
                [
                    require('crypto').randomUUID(), registroId, i,
                    p.nombre, p.descripcion || null, p.peso, p.unidad || null, p.direccion,
                    p.umbral_score1, p.umbral_score2, p.umbral_score3, p.umbral_score4, p.umbral_score5
                ]
            );
            pilaresInsertados.push(pilarResult.rows[0]);
        }

        await pool.query("UPDATE web.registro_objetivo_anual SET fecha_actualizacion = NOW() WHERE id = $1", [registroId]);

        res.json({ pilares: pilaresInsertados });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando los pilares" });
    }
});

// PUT: cargar el resultado real de un pilar y recalcular puntajes (pilar + final del registro)
app.put("/objetivos-anuales/:id/pilar/:pilar_id/resultado", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const pilarId = req.params.pilar_id;
        const { resultado_real } = req.body;

        const pilarData = await pool.query(
            "SELECT * FROM web.objetivo_anual_pilar WHERE id = $1 AND registro_id = $2",
            [pilarId, registroId]
        );
        if (pilarData.rows.length === 0) {
            return res.status(404).json({ error: "Pilar no encontrado" });
        }

        const puntaje = calcularPuntajePilarObjetivo(pilarData.rows[0], resultado_real);

        const pilarActualizado = await pool.query(
            `UPDATE web.objetivo_anual_pilar
             SET resultado_real = $1, puntaje = $2, fecha_resultado_cargado = NOW()
             WHERE id = $3 RETURNING *`,
            [parsearResultado(resultado_real), puntaje, pilarId]
        );

        const todosPilares = await pool.query(
            "SELECT * FROM web.objetivo_anual_pilar WHERE registro_id = $1",
            [registroId]
        );
        const { puntajeFinal, completo } = calcularPuntajeFinalObjetivos(todosPilares.rows);

        const registroActualizado = await pool.query(
            "UPDATE web.registro_objetivo_anual SET puntaje_final = $1, fecha_actualizacion = NOW() WHERE id = $2 RETURNING *",
            [puntajeFinal, registroId]
        );

        res.json({ pilar: pilarActualizado.rows[0], registro: registroActualizado.rows[0], completo });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error cargando el resultado del pilar" });
    }
});

// PUT: actualizar datos generales del registro (evaluador, año) o publicarlo
app.put("/objetivos-anuales/:id", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const { estado, evaluador, anio } = req.body;

        const registroData = await pool.query("SELECT * FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        const registro = registroData.rows[0];

        if (estado === 'publicado' && registro.estado !== 'publicado') {
            const pilaresData = await pool.query("SELECT * FROM web.objetivo_anual_pilar WHERE registro_id = $1", [registroId]);
            const faltantes = pilaresData.rows.filter(p => p.puntaje === null || p.puntaje === undefined);
            if (faltantes.length > 0) {
                return res.status(400).json({
                    error: "Faltan resultados por cargar antes de publicar",
                    pilares_pendientes: faltantes.map(p => p.nombre)
                });
            }
        }

        const nuevoEstado = estado || registro.estado;
        const result = await pool.query(
            `UPDATE web.registro_objetivo_anual
             SET estado = $1,
                 evaluador = COALESCE($2, evaluador),
                 anio = COALESCE($3, anio),
                 fecha_publicacion = CASE WHEN $1 = 'publicado' AND fecha_publicacion IS NULL THEN NOW() ELSE fecha_publicacion END,
                 fecha_actualizacion = NOW()
             WHERE id = $4 RETURNING *`,
            [nuevoEstado, evaluador || null, anio || null, registroId]
        );

        res.json({ registro: result.rows[0] });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando el registro" });
    }
});

// DELETE: eliminar un registro creado por error (sólo mientras está en borrador)
app.delete("/objetivos-anuales/:id", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        if (!(await requireAdminObjetivos(req, res))) return;

        const registroId = req.params.id;
        const registroData = await pool.query("SELECT * FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        if (registroData.rows[0].estado !== 'borrador') {
            return res.status(400).json({ error: "Sólo se pueden eliminar registros en borrador" });
        }

        await pool.query("DELETE FROM web.registro_objetivo_anual WHERE id = $1", [registroId]);
        res.json({ success: true });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando el registro" });
    }
});

/* MATRIZ 9-BOX */

// Función auxiliar: Obtener gerencia/sector del usuario autenticado
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

// Función auxiliar: Obtener reportes directos del usuario (1 nivel jerárquico abajo via puestodependencia)
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

// GET: Obtener listado de registros 9-box (propios + subordinados en lectura)
app.get("/nuevebox", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const username = req.user.username;

        const propiosResult = await pool.query(`
            SELECT *, true as es_propio
            FROM web.registro_9box
            WHERE creado_por = $1 OR creado_por IS NULL
            ORDER BY fecha_creacion DESC
        `, [username]);

        const subordinadosResult = await pool.query(`
            SELECT r.*, false as es_propio
            FROM web.registro_9box r
            JOIN ud_empleado ude_c ON ude_c.usuario_sistema = r.creado_por
            JOIN ud_puestoorganigrama puesto_c ON ude_c.puestoorganigrama_id = puesto_c.id
            WHERE puesto_c.dependencia_id = (
                SELECT puesto_sup.id FROM ud_empleado udemp_sup
                LEFT JOIN ud_puestoorganigrama puesto_sup ON udemp_sup.puestoorganigrama_id = puesto_sup.id
                WHERE udemp_sup.usuario_sistema = $1
                LIMIT 1
            )
            ORDER BY r.fecha_creacion DESC
        `, [username]);

        res.json({
            propios: propiosResult.rows,
            subordinados: subordinadosResult.rows
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo registros 9-box" });
    }
});

const EVALUACIONES_SELECT = `
    SELECT
        ev.id,
        ev.registro_id,
        ev.empleado_id,
        ev.competencias_score,
        ev.objetivos_score,
        ev.performance_score,
        ev.potential_score,
        ev.fit_score,
        ev.leader_potential,
        ev.commitment_score,
        ev.riesgo,
        ev.caja_sugerida,
        ev.caja_manual,
        ev.comentario,
        ev.en_pool,
        pers.nombre as empleado_nombre,
        s.nombre as area,
        g.nombre as gerencia,
        puesto.nombre as manager,
        ROUND((
            EXTRACT(YEAR FROM AGE(NOW(), TO_DATE(emp.fechaingreso, 'YYYYMMDD')))
            + EXTRACT(MONTH FROM AGE(NOW(), TO_DATE(emp.fechaingreso, 'YYYYMMDD'))) / 12.0
        )::numeric) AS tenure_years
    FROM web.evaluacion_9box ev
    LEFT JOIN empleado emp ON emp.id = ev.empleado_id
    LEFT JOIN personafisica pers ON emp.enteasociado_id = pers.id
    LEFT JOIN gerencia g ON g.id = emp.gerencia_id
    LEFT JOIN sector s ON s.id = emp.sector_id
    LEFT JOIN ud_empleado ude ON ude.id = emp.boextension_id
    LEFT JOIN ud_puestoorganigrama puesto ON ude.puestoorganigrama_id = puesto.id
`;

// GET: Obtener un registro específico con sus evaluaciones
app.get("/nuevebox/:id", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;

        const registroData = await pool.query(
            "SELECT * FROM web.registro_9box WHERE id = $1",
            [registroId]
        );

        if (registroData.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }

        const registro = registroData.rows[0];
        const creadorUsername = registro.creado_por;

        let puedeEditar = false;
        let evaluacionesData = [];

        const esCreador = !creadorUsername || creadorUsername === username;

        if (esCreador) {
            // Creador: filtra sus reportes directos, puede editar
            puedeEditar = true;
            const empleadosDisponibles = await obtenerReportesDirectos(username);
            const empleadosIds = empleadosDisponibles.map(e => e.id);
            if (empleadosIds.length > 0) {
                const placeholders = empleadosIds.map((_, i) => `$${i + 2}`).join(',');
                evaluacionesData = await pool.query(
                    `${EVALUACIONES_SELECT} WHERE ev.registro_id = $1 AND ev.empleado_id IN (${placeholders}) ORDER BY emp.descripcion ASC`,
                    [registroId, ...empleadosIds]
                );
            }
        } else {
            // Verificar si el creador es reporte directo del usuario (vista de superior)
            const esSuperior = await pool.query(`
                SELECT 1 FROM ud_empleado udemp_creador
                JOIN ud_puestoorganigrama puesto_creador ON udemp_creador.puestoorganigrama_id = puesto_creador.id
                WHERE udemp_creador.usuario_sistema = $1
                AND puesto_creador.dependencia_id = (
                    SELECT puesto_sup.id FROM ud_empleado udemp_sup
                    LEFT JOIN ud_puestoorganigrama puesto_sup ON udemp_sup.puestoorganigrama_id = puesto_sup.id
                    WHERE udemp_sup.usuario_sistema = $2
                    LIMIT 1
                )
            `, [creadorUsername, username]);

            if (esSuperior.rows.length === 0) {
                return res.status(403).json({ error: "No tienes acceso a este registro" });
            }

            // Superior jerárquico: ve todo el registro, sin poder editar
            puedeEditar = false;
            evaluacionesData = await pool.query(
                `${EVALUACIONES_SELECT} WHERE ev.registro_id = $1 ORDER BY emp.descripcion ASC`,
                [registroId]
            );
        }

        res.json({
            registro,
            evaluaciones: evaluacionesData.rows || [],
            puede_editar: puedeEditar,
            alerta_distribucion: calcularAlertaDistribucion9box(evaluacionesData.rows || [])
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo registro 9-box" });
    }
});

// GET: Obtener empleados disponibles para evaluar del usuario autenticado
app.get("/nuevebox/:id/empleados-disponibles", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;
        
        // Obtener información del usuario autenticado
        const infoUsuario = await obtenerGerenciaDelUsuario(username);
        if (!infoUsuario) {
            return res.status(403).json({ error: "No se puede determinar la gerencia/sector del usuario" });
        }
        
        // Obtener empleados que reportan directamente al usuario (1 nivel jerárquico abajo)
        const empleadosDisponibles = await obtenerReportesDirectos(username);
        
        // Obtener evaluaciones ya existentes
        const evaluacionesExistentes = await pool.query(`
            SELECT empleado_id FROM web.evaluacion_9box WHERE registro_id = $1
        `, [registroId]);
        
        const empleadosEvaluados = new Set(evaluacionesExistentes.rows.map(e => e.empleado_id));
        
        // Empleados pendientes (sin evaluar)
        const empleadosPendientes = empleadosDisponibles.filter(e => !empleadosEvaluados.has(e.id));
        
        res.json({
            disponibles: empleadosDisponibles,
            evaluados: Array.from(empleadosEvaluados),
            pendientes: empleadosPendientes,
            usuario_info: {
                gerencia_id: infoUsuario.gerencia_id,
                gerencia_nombre: infoUsuario.gerencia_nombre,
                sector: infoUsuario.sector
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo empleados disponibles" });
    }
});

/* Scoring 9-box asistido por IA, a partir de Genoma + Evaluación de desempeño */

const NUEVEBOX_SCORING_SYSTEM_PROMPT = `Sos un analista de People Analytics. Tu tarea es estimar el perfil de calibración 9-box de UN empleado a partir de los datos disponibles: resultados de una evaluación psicométrica externa (Genomawork) y/o resultados de la evaluación de desempeño interna (competencias calificadas de NIVEL 0 a NIVEL 4, siendo NIVEL 4 el máximo). Puede que solo tengas uno de los dos conjuntos de datos, o ambos: hacé la mejor estimación posible con lo que haya, y si falta alguno de los dos, aclaralo brevemente en el comentario.

Devolvé únicamente un JSON válido con esta forma exacta, sin texto adicional:
{
  "competencias_score": number,
  "objetivos_score": number,
  "performance_score": number,
  "potential_score": number,
  "fit_score": number,
  "leader_potential": number,
  "commitment_score": number,
  "comentario": "string"
}

Guía de cada campo:
- competencias_score (0.00 a 4.00): desempeño general en competencias blandas/técnicas.
- objetivos_score (0.00 a 4.00): orientación a resultados / cumplimiento de objetivos. Si no hay un dato explícito de objetivos, inferilo de competencias como "Orientación a los Resultados", "Planificación y Gestión" o "Iniciativa y Autonomía".
- performance_score (0.00 a 4.00): desempeño general, síntesis de las competencias evaluadas.
- potential_score (0.00 a 4.00): potencial de crecimiento futuro, combinando rasgos cognitivos/de aprendizaje de Genoma con competencias como "Pensamiento Estratégico" o "Desarrollo de Talento".
- fit_score (0 a 100): ajuste cultural/de rol. Si Genoma trae un FIT % o rasgos de cultura organizacional, priorizalos; si no hay datos de Genoma, estimalo de forma conservadora (cercano a 50) en base al desempeño.
- leader_potential (0 a 3, entero): potencial de liderazgo, en base a la competencia "Liderazgo" y rasgos de liderazgo de Genoma.
- commitment_score (0.00 a 4.00): compromiso, en base a la competencia "Compromiso" y rasgos de integridad/confiabilidad de Genoma.
- comentario: 2 a 3 oraciones breves en español (máximo 400 caracteres en total) explicando la recomendación y qué datos se usaron.

IMPORTANTE: No inventes datos que no estén presentes. Si la información es escasa, usá valores moderados (cercanos al centro de la escala) en vez de arriesgar un puntaje extremo sin evidencia, y aclaralo en el comentario.`;

async function obtenerDatosGenomaYDesempenoParaEmpleado(empleadoId) {
    const [genomaResult, desempenoResult] = await Promise.all([
        pool.query(
            `SELECT fecha, tipo_eval, evaluacion, resultado FROM web.genoma_registros WHERE empleado_id = $1 ORDER BY fecha DESC`,
            [empleadoId]
        ),
        pool.query(
            `SELECT fecha, encuesta, pregunta, puntuacion, usuario, usuario_evaluar
             FROM web.v_intranet_eval_desemp_completas_respuestas
             WHERE empleado_evaluar_id = $1
             ORDER BY fecha DESC`,
            [empleadoId]
        )
    ]);

    // Si la misma competencia fue evaluada por el propio empleado y por su superior, se prioriza la del superior.
    const desempenoPorClave = new Map();
    for (const row of desempenoResult.rows) {
        const clave = `${row.encuesta}||${row.pregunta}`;
        const esSuperior = row.usuario !== row.usuario_evaluar;
        const previa = desempenoPorClave.get(clave);
        if (!previa || (esSuperior && !previa.esSuperior)) {
            desempenoPorClave.set(clave, { fecha: row.fecha, encuesta: row.encuesta, pregunta: row.pregunta, puntuacion: row.puntuacion, esSuperior });
        }
    }

    return { genoma: genomaResult.rows, desempeno: Array.from(desempenoPorClave.values()) };
}

// Debe reflejar exactamente las mismas bandas que intranet-react/.../NueveBox/utils.js y constants.js,
// para que la caja sugerida por el backend coincida con la que recalcula el frontend.
function calcularCajaSugerida9box(performanceScore, potentialScore) {
    const bandaDesempeno = performanceScore < 1.6 ? 'low' : performanceScore < 2.6 ? 'mid' : 'high';
    const bandaPotencial = potentialScore < 1.7 ? 'low' : potentialScore < 2.4 ? 'mid' : 'high';
    const MATRIZ_CAJAS = {
        high: { low: 4, mid: 7, high: 9 },
        mid: { low: 2, mid: 5, high: 8 },
        low: { low: 1, mid: 3, high: 6 }
    };
    return MATRIZ_CAJAS[bandaDesempeno][bandaPotencial];
}

function clamp(valor, min, max, porDefecto) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return porDefecto;
    return Math.min(max, Math.max(min, n));
}

// No se evalúa (ni con IA ni manualmente) a colaboradores con esta antigüedad o menos:
// no hay historial suficiente de desempeño/potencial para ubicarlos en una caja.
const ANTIGUEDAD_MINIMA_MESES_9BOX = 6;

function tieneAntiguedadInsuficiente(tenureMonths) {
    const meses = Number(tenureMonths);
    return Number.isFinite(meses) && meses <= ANTIGUEDAD_MINIMA_MESES_9BOX;
}

// Rangos de referencia con respaldo de benchmark (ver info-prompts/distribucion-9box-referencia.html).
// Sirven solo para generar una alerta informativa al calibrar un registro, nunca para bloquear la carga.
const BENCHMARK_BLOQUES_9BOX = [
    { nombre: 'Solid performers', cajas: [2, 5, 8], min: 60, max: 70 },
    { nombre: 'High performers', cajas: [4, 7, 9], min: 15, max: 20 },
    { nombre: 'HIPOs totales', cajas: [8, 9], min: 5, max: 15 }
];

// Estimación proporcional por caja individual (sin benchmark directo, solo orientativa).
const BENCHMARK_CAJAS_9BOX = { 1: 5, 2: 30, 3: 7, 4: 10, 5: 25, 6: 5, 7: 6, 8: 10, 9: 2 };

// Muestra mínima para que comparar porcentajes contra el benchmark tenga sentido.
const MIN_EVALUADOS_PARA_ALERTA_DISTRIBUCION = 5;

// Alerta informativa (no bloqueante): compara la distribución real de un registro 9-box
// contra los rangos de referencia de la industria. Un desvío grande no implica que el
// dato esté mal, sino que conviene revisar el proceso de evaluación (ver disclaimer del reporte).
function calcularAlertaDistribucion9box(evaluaciones) {
    const ubicados = evaluaciones
        .map(ev => ev.caja_manual || ev.caja_sugerida)
        .filter(caja => caja != null)
        .map(Number);

    const total = ubicados.length;
    if (total < MIN_EVALUADOS_PARA_ALERTA_DISTRIBUCION) {
        return { evaluable: false, total_ubicados: total, advertencias: [] };
    }

    const conteoPorCaja = ubicados.reduce((acc, caja) => {
        acc[caja] = (acc[caja] || 0) + 1;
        return acc;
    }, {});

    const advertencias = [];

    for (const bloque of BENCHMARK_BLOQUES_9BOX) {
        const cantidad = bloque.cajas.reduce((sum, caja) => sum + (conteoPorCaja[caja] || 0), 0);
        const pct = Math.round((cantidad / total) * 1000) / 10;
        if (pct < bloque.min || pct > bloque.max) {
            advertencias.push({
                tipo: 'bloque',
                nombre: bloque.nombre,
                cajas: bloque.cajas,
                porcentaje_actual: pct,
                rango_esperado: [bloque.min, bloque.max],
                mensaje: `${bloque.nombre} está en ${pct}% de los evaluados (rango de referencia ${bloque.min}-${bloque.max}%). Puede valer la pena revisar el proceso de evaluación.`
            });
        }
    }

    for (const [caja, referencia] of Object.entries(BENCHMARK_CAJAS_9BOX)) {
        const cantidad = conteoPorCaja[caja] || 0;
        const pct = Math.round((cantidad / total) * 1000) / 10;
        const tolerancia = Math.max(referencia * 0.5, 5);
        if (Math.abs(pct - referencia) > tolerancia) {
            advertencias.push({
                tipo: 'caja',
                nombre: `Caja ${caja}`,
                cajas: [Number(caja)],
                porcentaje_actual: pct,
                referencia_orientativa: referencia,
                mensaje: `La caja ${caja} concentra ${pct}% de los evaluados (referencia orientativa ~${referencia}%, sin benchmark directo). Revisar si es consistente antes de asumir que el dato está mal.`
            });
        }
    }

    return { evaluable: true, total_ubicados: total, advertencias };
}

// Devuelve null si el empleado no tiene datos de Genoma ni de desempeño (no hay base para estimar nada).
async function calcularScores9boxConIA(empleadoId) {
    const { genoma, desempeno } = await obtenerDatosGenomaYDesempenoParaEmpleado(empleadoId);

    if (genoma.length === 0 && desempeno.length === 0) {
        return null;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const aiResponse = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            { role: "system", content: [{ type: "input_text", text: NUEVEBOX_SCORING_SYSTEM_PROMPT }] },
            {
                role: "user",
                content: [{
                    type: "input_text",
                    text: `Datos de Genomawork (evaluación psicométrica):\n${genoma.length ? JSON.stringify(genoma) : "No hay datos de Genomawork para este empleado."}\n\nDatos de evaluación de desempeño (competencias NIVEL 0-4):\n${desempeno.length ? JSON.stringify(desempeno) : "No hay datos de evaluación de desempeño para este empleado."}`
                }]
            }
        ],
        text: { format: { type: "json_object" } },
        temperature: 0,
        max_output_tokens: 1024,
        store: false
    });

    const datos = JSON.parse(aiResponse.output_text);

    const performanceScore = clamp(datos.performance_score, 0, 4, 2);
    const potentialScore = clamp(datos.potential_score, 0, 4, 2);

    return {
        competencias_score: clamp(datos.competencias_score, 0, 4, 2),
        objetivos_score: clamp(datos.objetivos_score, 0, 4, 2),
        performance_score: performanceScore,
        potential_score: potentialScore,
        fit_score: clamp(datos.fit_score, 0, 100, 50),
        leader_potential: Math.round(clamp(datos.leader_potential, 0, 3, 0)),
        commitment_score: clamp(datos.commitment_score, 0, 4, 2),
        caja_sugerida: calcularCajaSugerida9box(performanceScore, potentialScore),
        comentario: typeof datos.comentario === 'string' ? datos.comentario.slice(0, 500) : ''
    };
}

// POST: Crear nuevo registro 9-box y cargar automáticamente empleados del usuario
app.post("/nuevebox", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const { nombre, anio, estado } = req.body;
        const username = req.user.username;
        
        if (!nombre || !anio) {
            return res.status(400).json({ error: "Nombre y año son requeridos" });
        }
        
        // Obtener gerencia del usuario
        const infoUsuario = await obtenerGerenciaDelUsuario(username);
        if (!infoUsuario) {
            return res.status(403).json({ error: "No se puede determinar la gerencia/sector del usuario" });
        }
        
        const registroId = require('crypto').randomUUID();
        
        // Crear registro
        const registroResult = await pool.query(
            "INSERT INTO web.registro_9box (id, nombre, anio, estado, fecha_creacion, creado_por) VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING *",
            [registroId, nombre, anio, estado || 'borrador', username]
        );
        
        // Obtener empleados que reportan directamente al usuario (1 nivel jerárquico abajo)
        const empleadosDisponibles = await obtenerReportesDirectos(username);
        
        // Crear evaluaciones automáticamente para cada empleado, con scores sugeridos por IA
        // (en base a Genoma + evaluación de desempeño previas, si el empleado tiene algo cargado)
        if (empleadosDisponibles.length > 0) {
            const insertPromises = empleadosDisponibles.map(async emp => {
                // Antigüedad insuficiente: queda en el pool sin sugerencia de la IA (no hay
                // historial suficiente de desempeño/potencial para ubicarlo en una caja).
                if (tieneAntiguedadInsuficiente(emp.tenure_months)) {
                    return pool.query(
                        `INSERT INTO web.evaluacion_9box
                         (id, registro_id, empleado_id, competencias_score, objetivos_score,
                          performance_score, potential_score, fit_score, leader_potential,
                          commitment_score, riesgo, caja_sugerida, comentario, en_pool)
                         VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, 0, 'Bajo', NULL, $4, true)`,
                        [
                            require('crypto').randomUUID(),
                            registroId,
                            emp.id,
                            `Ingreso reciente (antigüedad de ${Math.floor(Number(emp.tenure_months))} meses): aún no evaluable en el modelo 9-box.`
                        ]
                    );
                }

                let scores = null;
                try {
                    scores = await calcularScores9boxConIA(emp.id);
                } catch (err) {
                    console.log(`[nuevebox-ia] error calculando scores para empleado_id=${emp.id}`, err);
                }

                const s = scores || {
                    competencias_score: 0, objetivos_score: 0, performance_score: 0, potential_score: 0,
                    fit_score: 0, leader_potential: 0, commitment_score: 0, caja_sugerida: null, comentario: ''
                };

                try {
                    return await pool.query(
                        `INSERT INTO web.evaluacion_9box
                         (id, registro_id, empleado_id, competencias_score, objetivos_score,
                          performance_score, potential_score, fit_score, leader_potential,
                          commitment_score, riesgo, caja_sugerida, comentario, en_pool)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            require('crypto').randomUUID(),
                            registroId,
                            emp.id,
                            s.competencias_score, s.objetivos_score, s.performance_score, s.potential_score,
                            s.fit_score, s.leader_potential, s.commitment_score,
                            'Bajo', // riesgo
                            s.caja_sugerida,
                            s.comentario,
                            s.caja_sugerida == null // en_pool: si la IA no pudo sugerir una caja (sin datos), queda pendiente de ubicar
                        ]
                    );
                } catch (err) {
                    // Si el insert falla (ej. por datos fuera de rango), reintentamos en blanco
                    // para que el empleado no quede completamente afuera del registro.
                    console.log(`[nuevebox-ia] error insertando evaluación de empleado_id=${emp.id}, se reintenta en blanco`, err);
                    return pool.query(
                        `INSERT INTO web.evaluacion_9box
                         (id, registro_id, empleado_id, competencias_score, objetivos_score,
                          performance_score, potential_score, fit_score, leader_potential,
                          commitment_score, riesgo, caja_sugerida, comentario, en_pool)
                         VALUES ($1, $2, $3, 0, 0, 0, 0, 0, 0, 0, 'Bajo', NULL, '', true)`,
                        [require('crypto').randomUUID(), registroId, emp.id]
                    );
                }
            });

            await Promise.all(insertPromises);
        }
        
        res.status(201).json({
            success: true,
            message: `Registro creado con ${empleadosDisponibles.length} empleados cargados automáticamente`,
            data: {
                ...registroResult.rows[0],
                empleados_cargados: empleadosDisponibles.length,
                usuario_info: {
                    gerencia_id: infoUsuario.gerencia_id,
                    gerencia_nombre: infoUsuario.gerencia_nombre,
                    sector: infoUsuario.sector
                }
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando registro 9-box" });
    }
});

// PUT: Actualizar estado del registro
app.put("/nuevebox/:id", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const registroId = req.params.id;
        const username = req.user.username;
        const { estado } = req.body;

        const ownership = await pool.query(
            "SELECT creado_por FROM web.registro_9box WHERE id = $1",
            [registroId]
        );
        if (ownership.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }

        const creadorUsername = ownership.rows[0].creado_por;
        if (creadorUsername && creadorUsername !== username) {
            return res.status(403).json({ error: "Solo el creador puede modificar el estado del registro" });
        }

        if (!['borrador', 'calibrado', 'publicado'].includes(estado)) {
            return res.status(400).json({ error: "Estado inválido" });
        }

        const fecha_cierre = estado === 'publicado' ? new Date() : null;

        const result = await pool.query(
            "UPDATE web.registro_9box SET estado = $1, fecha_cierre = $2 WHERE id = $3 RETURNING *",
            [estado, fecha_cierre, registroId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Registro no encontrado" });
        }
        
        res.json({
            success: true,
            message: "Registro actualizado correctamente",
            data: result.rows[0]
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando registro" });
    }
});

// PUT: Actualizar evaluación (caja manual y comentario)
app.put("/nuevebox/:id/evaluacion/:empleado_id", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        const { id: registroId, empleado_id: empleadoId } = req.params;
        const username = req.user.username;

        const ownership = await pool.query(
            "SELECT creado_por FROM web.registro_9box WHERE id = $1",
            [registroId]
        );
        const creadorUsername = ownership.rows[0]?.creado_por;
        if (creadorUsername && creadorUsername !== username) {
            return res.status(403).json({ error: "Solo el creador puede editar las evaluaciones" });
        }

        const { caja_manual, comentario, en_pool, competencias_score, objetivos_score, performance_score, potential_score, fit_score, leader_potential, commitment_score, riesgo } = req.body;

        if (caja_manual) {
            const antiguedad = await pool.query(
                `SELECT (
                    EXTRACT(YEAR FROM AGE(NOW(), TO_DATE(fechaingreso, 'YYYYMMDD'))) * 12
                    + EXTRACT(MONTH FROM AGE(NOW(), TO_DATE(fechaingreso, 'YYYYMMDD')))
                 )::numeric AS tenure_months
                 FROM empleado WHERE id = $1`,
                [empleadoId]
            );
            if (tieneAntiguedadInsuficiente(antiguedad.rows[0]?.tenure_months)) {
                return res.status(400).json({ error: `No se puede evaluar: el colaborador tiene ${ANTIGUEDAD_MINIMA_MESES_9BOX} meses o menos de antigüedad` });
            }
        }

        const result = await pool.query(
            `UPDATE web.evaluacion_9box
             SET caja_manual = $1,
                 comentario = $2,
                 en_pool = $3,
                 competencias_score = COALESCE($4, competencias_score),
                 objetivos_score = COALESCE($5, objetivos_score),
                 performance_score = COALESCE($6, performance_score),
                 potential_score = COALESCE($7, potential_score),
                 fit_score = COALESCE($8, fit_score),
                 leader_potential = COALESCE($9, leader_potential),
                 commitment_score = COALESCE($10, commitment_score),
                 riesgo = COALESCE($11, riesgo)
             WHERE registro_id = $12 AND empleado_id = $13 
             RETURNING *`,
            [
                caja_manual || null, 
                comentario || '', 
                en_pool !== undefined ? en_pool : false,
                competencias_score,
                objetivos_score,
                performance_score,
                potential_score,
                fit_score,
                leader_potential,
                commitment_score,
                riesgo,
                registroId, 
                empleadoId
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Evaluación no encontrada" });
        }
        
        res.json({
            success: true,
            message: "Evaluación actualizada correctamente",
            data: result.rows[0]
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error actualizando evaluación" });
    }
});

/* Análisis de informes Genomawork -> web.genoma_registros */

const uploadGenoma = multer({ storage: multer.memoryStorage() });
const { pdfToPng } = require('pdf-to-png-converter');

const GENOMA_SYSTEM_PROMPT = `Eres un extractor de datos de informes de evaluación de Genomawork. Vas a recibir las páginas del informe como IMÁGENES (una por página, en orden). Tu tarea es identificar CADA resultado de evaluación individual mencionado en el informe (cada rasgo, dimensión o indicador que tenga un puntaje o nivel propio, incluyendo los números que aparecen dentro de círculos/badges sobre las curvas y los valores de las barras en los gráficos) y devolverlos todos como una lista estructurada, sin resumir ni combinar varios en uno solo.

Un informe de Genomawork está organizado en secciones. Usá el título de la sección tal como aparece en el documento como "tipo_eval", por ejemplo: "Rasgos cognitivos", "Rasgos de personalidad", "Rasgos conductuales", "Liderazgo", "Integridad", "Habilidades colaborativas", "Evaluación de Cultura Organizacional", etc. Si una misma dimensión de liderazgo o de integridad aparece tanto en un gráfico (barras/círculo) como repetida en un texto narrativo con el mismo valor, incluila UNA sola vez (no dupliques el mismo ítem con el mismo valor bajo dos tipo_eval distintos).

Dentro de cada sección hay ítems individuales evaluados (por ejemplo: "Razonamiento deductivo", "Capacidad de planificación", "Responsabilidad", "Estimulación intelectual", "Confiabilidad", "Cooperación", "Grupal/Individual") — cada uno de estos nombres va en "evaluacion".

El "resultado" de cada evaluación se expresa de distintas formas según la sección, y tenés que leer el número o texto exacto tal como se ve en la imagen, SIN normalizar a otra escala:
- El número dentro del círculo/badge sobre la curva de distribución (rasgos cognitivos, de personalidad, conductuales), de 0 a 100. Ej: "69".
- La altura de cada barra en el gráfico de liderazgo (0 a 12 puntos), leyendo el eje Y con cuidado. Ej: "8".
- Un porcentaje junto a un nivel cualitativo (habilidades colaborativas). Ej: "25% - Medio".
- Una clasificación cualitativa (integridad). Ej: "RIESGO BAJO" o "RIESGO ALTO".
- Un puntaje "X puntos" mencionado en prosa (ej. Responsabilidad/Amabilidad/Neuroticismo dentro de Integridad).
- Una preferencia cualitativa (cultura organizacional). Ej: "Ligera preferencia por el ambiente grupal".

IMPORTANTE - No inventes datos: leé con atención cada imagen antes de responder. Si un número no es legible con claridad en la imagen (borroso, cortado, tapado, o realmente ausente), devolvé "resultado": null para ese ítem en vez de adivinar o completar con un valor plausible. Es preferible null que un dato no verificable.

Además del listado, extraé también estos datos generales si están visibles en la primera página o el encabezado del informe:
- "candidato": nombre completo del candidato/evaluado.
- "cargo": cargo o proceso para el que fue evaluado.
- "fecha_evaluacion": fecha del informe en formato YYYY-MM-DD si es legible, o null.
- "fit_pct": el porcentaje de FIT mostrado en el encabezado (solo el número, sin el símbolo %), o null si no aparece.
- "email": email de contacto si aparece, o null.
- "telefono": teléfono de contacto si aparece, o null.

Devolvé únicamente un JSON válido con este formato exacto, sin texto adicional:
{
  "candidato": "string o null",
  "cargo": "string o null",
  "fecha_evaluacion": "YYYY-MM-DD o null",
  "fit_pct": number o null,
  "email": "string o null",
  "telefono": "string o null",
  "resultados": [
    { "tipo_eval": "string", "evaluacion": "string", "resultado": "string o null" }
  ]
}`;

async function procesarInformeGenomaPdf(pdfBuffer, { empleadoId = null, fechaOverride = null } = {}) {
    const paginas = await pdfToPng(pdfBuffer, { viewportScale: 2.0, disableFontFace: true });
    const imagenes = paginas.map(p => ({
        type: "input_image",
        image_url: `data:image/png;base64,${p.content.toString('base64')}`
    }));

    const openai = new OpenAI({ apiKey: process.env.OPENAI_GENOMA_API_KEY });
    const aiResponse = await openai.responses.create({
        model: "gpt-4.1",
        input: [
            {
                role: "system",
                content: [{ type: "input_text", text: GENOMA_SYSTEM_PROMPT }]
            },
            {
                role: "user",
                content: [
                    { type: "input_text", text: "Estas son las páginas del informe de Genomawork, en orden:" },
                    ...imagenes
                ]
            }
        ],
        text: { format: { type: "json_object" } },
        temperature: 0,
        max_output_tokens: 4096,
        store: false
    });

    const genomaDatos = JSON.parse(aiResponse.output_text);
    const resultados = Array.isArray(genomaDatos.resultados) ? genomaDatos.resultados : [];

    const fechaExtraida = genomaDatos.fecha_evaluacion && !isNaN(Date.parse(genomaDatos.fecha_evaluacion)) ? genomaDatos.fecha_evaluacion : null;
    const fecha = fechaOverride || fechaExtraida || new Date().toISOString().slice(0, 10);

    const insertPromises = resultados
        .filter(item => item && item.evaluacion)
        .map(item =>
            pool.query(
                `INSERT INTO web.genoma_registros (fecha, empleado_id, evaluacion, resultado, tipo_eval)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [
                    fecha,
                    empleadoId,
                    String(item.evaluacion).slice(0, 150),
                    item.resultado != null ? String(item.resultado).slice(0, 500) : null,
                    item.tipo_eval ? String(item.tipo_eval).slice(0, 150) : null
                ]
            )
        );

    const insertResults = await Promise.all(insertPromises);

    return { genomaDatos, fecha, insertResults };
}

app.post("/genoma", passport.authenticate('jwt', { session: false }), uploadGenoma.single('pdf'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Archivo PDF requerido" });

        const empleadoId = req.body.empleado_id || null;
        const fechaBody = req.body.fecha && !isNaN(Date.parse(req.body.fecha)) ? req.body.fecha : null;

        const { genomaDatos, fecha, insertResults } = await procesarInformeGenomaPdf(req.file.buffer, {
            empleadoId,
            fechaOverride: fechaBody
        });

        res.json({
            success: true,
            candidato: genomaDatos.candidato || null,
            cargo: genomaDatos.cargo || null,
            fecha_evaluacion: fecha,
            fit_pct: genomaDatos.fit_pct ?? null,
            email: genomaDatos.email || null,
            telefono: genomaDatos.telefono || null,
            registros_insertados: insertResults.length,
            data: insertResults.map(r => r.rows[0])
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error analizando informe de Genomawork" });
    }
});

/* Detección automática de informes Genomawork nuevos cargados en el ERP */

const cron = require('node-cron');

const GENOMA_ERP_QUERY = `
    SELECT v_l.id AS doc_link_id, emp.id AS empleado_id, v_l.xfilename, v_b.blobdata AS genoma_pdf
    FROM EMPLEADO emp
    JOIN V_BODBDOCLINK v_l ON emp.id = v_l.linkedobj_id
    JOIN blobs v_b ON v_b.id = v_l.data
    LEFT JOIN web.genoma_pdfs_procesados proc ON proc.doc_link_id = v_l.id
    WHERE v_l.xfilename ILIKE '%informe-candidato%'
      AND proc.id IS NULL
`;

async function procesarGenomaPdfsPendientesERP() {
    let rows;
    try {
        ({ rows } = await pool.query(GENOMA_ERP_QUERY));
    } catch (err) {
        console.log('[genoma-erp] error consultando informes pendientes', err);
        return;
    }

    if (rows.length === 0) return;

    console.log(`[genoma-erp] ${rows.length} informe(s) nuevo(s) detectado(s)`);

    for (const row of rows) {
        try {
            await procesarInformeGenomaPdf(row.genoma_pdf, { empleadoId: row.empleado_id });
            await pool.query(
                `INSERT INTO web.genoma_pdfs_procesados (doc_link_id, empleado_id, xfilename, estado)
                 VALUES ($1, $2, $3, 'ok')`,
                [row.doc_link_id, row.empleado_id, row.xfilename]
            );
        } catch (err) {
            console.log(`[genoma-erp] error procesando doc_link_id=${row.doc_link_id}`, err);
            try {
                await pool.query(
                    `INSERT INTO web.genoma_pdfs_procesados (doc_link_id, empleado_id, xfilename, estado, detalle_error)
                     VALUES ($1, $2, $3, 'error', $4)`,
                    [row.doc_link_id, row.empleado_id, row.xfilename, String(err.message || err).slice(0, 500)]
                );
            } catch (logErr) {
                console.log(`[genoma-erp] no se pudo registrar el error de doc_link_id=${row.doc_link_id}`, logErr);
            }
        }
    }
}

cron.schedule('0 * * * *', procesarGenomaPdfsPendientesERP);

module.exports = { procesarGenomaPdfsPendientesERP, procesarInformeGenomaPdf, calcularScores9boxConIA };

/* Carga CVs */

const uploadCV = multer({ storage: multer.memoryStorage() });

async function getEmpleadoId(username) {
    try {
        const result = await pool.query(
            "SELECT e.id FROM empleado e LEFT JOIN ud_empleado ude ON ude.id = e.boextension_id WHERE ude.usuario_sistema = $1",
            [username]
        );
        return result.rows[0]?.id || null;
    } catch (err) {
        console.log(err);
        return null;
    }
}

app.get("/cvs", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        const allDatas = await pool.query(
            "SELECT id, nombre_archivo, fecha, mime_type FROM web.intranet_cv WHERE empleado_id = $1 ORDER BY fecha DESC",
            [empleadoId]
        );
        res.json(allDatas.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo CVs" });
    }
});

app.post("/cvs", passport.authenticate('jwt', { session: false }), uploadCV.single('cv'), async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        if (!req.file) return res.status(400).json({ error: "Archivo requerido" });

        const nombre = req.body.nombre_archivo || req.file.originalname;

        const textoPdf = await parsePdfBuffer(req.file.buffer);

        // Si pdfreader no logra extraer texto (CV escaneado o compuesto por imágenes),
        // se procesan las páginas del PDF como imágenes con el modelo de visión.
        const TEXTO_MINIMO = 40;
        let userContent;
        if (textoPdf.trim().length >= TEXTO_MINIMO) {
            userContent = [{ type: "input_text", text: `Texto del CV:\n\n${textoPdf}` }];
        } else {
            const paginas = await pdfToPng(req.file.buffer, { viewportScale: 2.0, disableFontFace: true });
            userContent = [
                { type: "input_text", text: "Estas son las páginas del CV, en orden:" },
                ...paginas.map(p => ({
                    type: "input_image",
                    image_url: `data:image/png;base64,${p.content.toString('base64')}`
                }))
            ];
        }

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const aiResponse = await openai.responses.create({
            model: "gpt-4.1",
            input: [
                {
                    role: "system",
                    content: [{
                        type: "input_text",
                        text: `Eres un extractor de información de currículums vitae. Dado el contenido de un CV (texto o imágenes de sus páginas), extraé la información estructurada y devolvé únicamente un JSON válido con este formato:
                    {
                        "nombre_completo": "string",
                        "email": "string",
                        "telefono": "string",
                        "direccion": "string",
                        "perfil_profesional": "string",
                        "experiencia_laboral": [{ "empresa": "string", "puesto": "string", "fecha_inicio": "string", "fecha_fin": "string", "descripcion": "string" }],
                        "educacion": [{ "institucion": "string", "titulo": "string", "fecha_inicio": "string", "fecha_fin": "string" }],
                        "habilidades": ["string"],
                        "idiomas": [{ "idioma": "string", "nivel": "string" }],
                        "certificaciones": ["string"]
                    }
                    Si un campo no está disponible usá null. Devolvé únicamente el JSON, sin texto adicional.`
                    }]
                },
                {
                    role: "user",
                    content: userContent
                }
            ],
            text: { format: { type: "json_object" } },
            temperature: 0,
            max_output_tokens: 2048,
            store: false
        });

        const cvDatos = JSON.parse(aiResponse.output_text);

        const result = await pool.query(
            "INSERT INTO web.intranet_cv (empleado_id, cv, nombre_archivo, mime_type, cv_datos) VALUES($1, $2, $3, $4, $5) RETURNING id, nombre_archivo, fecha, mime_type",
            [empleadoId, req.file.buffer, nombre, req.file.mimetype, JSON.stringify(cvDatos)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error subiendo CV" });
    }
});

app.delete("/cvs/:id", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        await pool.query(
            "DELETE FROM web.intranet_cv WHERE id = $1 AND empleado_id = $2",
            [req.params.id, empleadoId]
        );
        res.sendStatus(200);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando CV" });
    }
});

app.get("/cvs/:id/download", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const empleadoId = await getEmpleadoId(req.user.username);
        if (!empleadoId) return res.status(404).json({ error: "Empleado no encontrado" });
        const result = await pool.query(
            "SELECT cv, nombre_archivo, mime_type FROM web.intranet_cv WHERE id = $1 AND empleado_id = $2",
            [req.params.id, empleadoId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "CV no encontrado" });
        const { cv, nombre_archivo, mime_type } = result.rows[0];
        res.setHeader('Content-Type', mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre_archivo || 'cv'}"`);
        res.send(cv);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error descargando CV" });
    }
});

/* Asistentes RRHH — chat multi-agente (exclusivo grupo 'rrhh') */

const PROMPT_EVAL_PUNTOS = `Rol: Actúa como un Consultor Senior de RRHH experto en Compensaciones y Desarrollo Organizacional para la empresa Escorial (empresa familiar argentina de 73 años, fabricante de cocinas, termotanques y calefones).

Tu Misión: Tu objetivo es valuar puestos de trabajo "Fuera de Convenio" utilizando el Método de Clasificación por Puntos definido en el Manual de la compañía (incluido a continuación). Tu meta es eliminar solapamientos salariales y detectar cuadros de reemplazo.

Contexto de Escorial:
- Cultura: Basada en Integridad, Trabajo en Equipo y Mejora Continua.
- Prioridad Estratégica: Seguridad, Salud y Medio Ambiente (responsabilidad de todos).
- Universo: Puestos desde Recepción hasta Gerencia de Primera Línea.

Reglas de Valuación (Manual):
Utilizarás una escala de 1.000 puntos distribuida en 15 competencias, cada una con 5 grados (G1=20%, G2=40%, G3=60%, G4=80%, G5=100% del peso del factor):
- Toma de Decisiones (10%)
- Orientación a Resultados (10%)
- Liderazgo (10%)
- Pensamiento Estratégico (8%)
- Planificación y Gestión (8%)
- Desarrollo del Talento (8%) - Crucial para cuadros de reemplazo.
- Conocimientos Técnicos (8%)
- Iniciativa y Autonomía (6%)
- Mejora Continua (6%)
- Resolución de Conflictos (6%)
- Trabajo en Equipo (6%)
- Compromiso/Integridad (5%)
- Flexibilidad/Adaptación (5%)
- Comunicación Eficaz (4%)
- Orientación al Cliente (4%)

Instrucciones de Trabajo:
Analiza los documentos adjuntos (Descripciones de Puesto) que el usuario te irá adjuntando de manera progresiva, uno o varios por mensaje. Preguntá si hay más archivos para cargar o si ya finalizó. Si el usuario responde "finalice" (o equivalente), el análisis debe cubrir todos los puestos adjuntados hasta ese momento. Como resumen al final del análisis, armá una tabla markdown con todos los puestos y el puntaje conseguido para que sea de fácil lectura.

Para cada puesto, asigná un Grado (1 al 5) en cada una de las 15 competencias, justificando tu elección según las funciones descritas en la Descripción de Puesto.

Calculá el puntaje total (suma de los 15 factores).

Clasificá el puesto en una de estas bandas:
- Banda A (851-1000 pts): Gerencial.
- Banda B (651-850 pts): Jefaturas / Especialistas Sr.
- Banda C (451-650 pts): Coordinación / Analistas SR.
- Banda D (251-450 pts): Analistas / Asistentes.

Identificá si el puesto requiere un "Cuadro de Reemplazo" basado en su complejidad (especialmente si el grado en Desarrollo del Talento y Conocimientos Técnicos es alto).

No evalúes a la persona que ocupa el cargo, sino los requisitos mínimos y responsabilidades que el puesto exige para ser exitoso.`;

const MANUAL_EVALUACION_PUNTOS_TEXTO = `--- MANUAL DE EVALUACIÓN DE PUESTOS POR PUNTOS (referencia oficial de Escorial) ---

Objetivo: Establecer una metodología objetiva, técnica y equitativa para determinar el valor relativo de cada puesto fuera de convenio, facilitar cuadros de reemplazo y planes de carrera, alinear responsabilidades con la visión estratégica, y eliminar inconsistencias y solapamientos salariales.

Alcance: Todas las posiciones fuera de convenio, desde niveles operativos (ej. Recepcionista) hasta niveles directivos (Gerencias).

Dimensiones (15 competencias agrupadas en 4 dimensiones):
- Dimensión Estratégica (24%): Toma de Decisiones, Pensamiento Estratégico, Iniciativa y Autonomía.
- Dimensión de Gestión (24%): Orientación a Resultados, Planificación y Gestión, Mejora Continua.
- Dimensión Relacional (28%): Liderazgo, Desarrollo del Talento, Trabajo en Equipo, Comunicación Eficaz.
- Dimensión Metodológica y Cultural (24%): Conocimientos Técnicos, Resolución de Conflictos, Orientación al Cliente, Compromiso, Flexibilidad-Adaptación.

Proceso: Paso 1) Usar la Descripción de Puesto vigente. Paso 2) Asignar Grado 1-5 por competencia comparando la DP contra la escala de grados. Paso 3) Multiplicar el grado por el valor de puntos de la Matriz de Puntuación. Paso 4) Sumar los 15 factores y ubicar en la Banda Salarial correspondiente.

DICCIONARIO DE COMPETENCIAS Y GRADOS:

1. DIMENSIÓN ESTRATÉGICA
Toma de Decisiones (10%):
 G1: Decisiones rutinarias sobre su propia tarea con supervisión directa.
 G2: Elige entre opciones predefinidas para resolver problemas operativos diarios.
 G3: Toma decisiones que afectan el flujo de trabajo de su sector basándose en el análisis de recursos.
 G4: Decisiones tácticas con impacto presupuestario y funcional en su área.
 G5: Decisiones estratégicas de alta complejidad que impactan en los resultados globales y la sustentabilidad de la empresa.
Pensamiento Estratégico (8%):
 G1: Comprende las tareas inmediatas y su impacto directo.
 G2: Entiende la relación entre su trabajo y los objetivos de su departamento.
 G3: Identifica tendencias y cambios en su entorno de trabajo inmediato.
 G4: Analiza y comprende cambios del entorno para determinar su impacto a corto y mediano plazo.
 G5: Visualiza y lidera con enfoque integral, alineando la organización con la visión a largo plazo.
Iniciativa y Autonomía (6%):
 G1: Requiere instrucciones detalladas y supervisión constante.
 G2: Actúa proactivamente en tareas sencillas sin esperar indicaciones.
 G3: Resuelve problemas comunes de forma independiente con criterio propio.
 G4: Implementa soluciones a retos nuevos con decisión e independencia de criterio.
 G5: Responde con rapidez y eficacia ante requerimientos críticos del entorno de negocio.

2. DIMENSIÓN DE GESTIÓN
Orientación a los Resultados (10%):
 G1: Realiza el trabajo asignado en el tiempo previsto.
 G2: Busca cumplir con los estándares de calidad y seguridad establecidos.
 G3: Moviliza recursos para superar desafíos y cumplir metas del sector.
 G4: Establece indicadores y realiza un seguimiento permanente para maximizar el rendimiento.
 G5: Supera consistentemente los resultados esperados bajo estándares de excelencia global.
Planificación y Gestión (8%):
 G1: Organiza sus actividades diarias siguiendo un cronograma dado.
 G2: Estructura acciones sencillas con plazos alcanzables.
 G3: Define metas y prioridades para su equipo de trabajo.
 G4: Realiza una gestión rigurosa mediante mecanismos de seguimiento y evaluación de riesgos.
 G5: Diseña y asegura el cumplimiento de planes complejos con visión a largo plazo.
Mejora Continua (6%):
 G1: Aplica los métodos y procesos de trabajo existentes.
 G2: Identifica oportunidades de mejora en su puesto de trabajo.
 G3: Propone soluciones creativas para optimizar recursos en su sector.
 G4: Genera valor mediante enfoques innovadores y métodos originales ante situaciones inesperadas.
 G5: Lidera la cultura de excelencia operacional y transformación de ideas en acción.

3. DIMENSIÓN RELACIONAL
Liderazgo (10%):
 G1: Colabora con compañeros sin ejercer rol de guía.
 G2: Actúa como referente técnico o guía para ingresos recientes.
 G3: Inspira y motiva a sus colaboradores directos hacia los objetivos.
 G4: Fomenta una cultura de aprendizaje continuo y optimización de procesos.
 G5: Comunica la visión estratégica y transmite los valores de Escorial a través de sus acciones.
Desarrollo del Talento (8%):
 G1: Se ocupa de su propio aprendizaje y actualización básica.
 G2: Identifica necesidades de capacitación propias para mejorar resultados.
 G3: Incentiva el desarrollo de conocimientos en su equipo inmediato.
 G4: Fomenta activamente la incorporación de nuevos conocimientos en el área.
 G5: Diseña e implementa planes de sucesión y cuadros de reemplazo estratégicos.
Trabajo en Equipo (6%):
 G1: Trabaja de forma individual respetando el entorno.
 G2: Colabora activamente con los miembros de su propio equipo.
 G3: Subordina intereses personales a los objetivos grupales del sector.
 G4: Trabaja con otras áreas para alcanzar la estrategia organizacional.
 G5: Elimina barreras y fomenta la colaboración integral en toda la compañía.
Comunicación Eficaz (4%):
 G1: Transmite información básica de manera correcta.
 G2: Escucha y entiende los requerimientos de sus pares.
 G3: Transmite de forma clara y oportuna la información requerida por los demás.
 G4: Mantiene redes de contacto formales e informales en diferentes niveles.
 G5: Asegura una comunicación abierta, transparente y alineada a los valores de la empresa.

4. DIMENSIÓN METODOLÓGICA Y CULTURAL
Conocimientos Técnicos (8%):
 G1: Posee conocimientos básicos para tareas de apoyo.
 G2: Demuestra experiencia específica requerida para la función a cargo.
 G3: Mantiene actualizados sus conocimientos en su campo de especialización.
 G4: Domina ampliamente su campo y comparte experiencias con otros.
 G5: Es referente técnico interno y externo en temas críticos para el negocio.
Resolución de Conflictos - Problemas (6%):
 G1: Reporta problemas para que otros los resuelvan.
 G2: Identifica relaciones causa-efecto en problemas técnicos sencillos.
 G3: Entiende situaciones desglosándolas en partes para encontrar soluciones prácticas.
 G4: Facilita el diálogo y promueve alternativas satisfactorias en conflictos interpersonales.
 G5: Asegura soluciones efectivas y sostenibles para problemas de alta complejidad.
Orientación al Cliente (4%):
 G1: Brinda una atención amable ante consultas básicas.
 G2: Comprende adecuadamente las demandas de clientes internos y externos.
 G3: Actúa con vocación permanente de servicio generando soluciones efectivas.
 G4: Supera las expectativas de los clientes priorizando la calidad y funcionalidad.
 G5: Diseña estrategias para maximizar la experiencia del cliente y la confianza sólida.
Compromiso - Integridad (5%):
 G1: Conoce los valores de la organización.
 G2: Cumple con las obligaciones personales y profesionales establecidas.
 G3: Se identifica con los valores actuando con integridad y honestidad.
 G4: Apoya e instrumenta decisiones alineando su comportamiento a las metas.
 G5: Honra todas sus acciones y acuerdos, siendo modelo de transparencia y ética.
Flexibilidad - Adaptación (5%):
 G1: Acepta cambios en su rutina de trabajo si se le indica.
 G2: Adapta su comportamiento a distintos contextos y personas de forma adecuada.
 G3: Modifica su enfoque ante situaciones cambiantes para alcanzar objetivos.
 G4: Identifica oportunidades de mejora en medios y situaciones inciertas.
 G5: Promueve la versatilidad organizacional y la agilidad ante retos del mercado.

MATRIZ DE PUNTUACIÓN (puntos por grado, según el peso de cada competencia):
Competencia | Peso | G1 | G2 | G3 | G4 | G5
Toma de Decisiones | 10% | 20 | 40 | 60 | 80 | 100
Pensamiento Estratégico | 8% | 16 | 32 | 48 | 64 | 80
Iniciativa y Autonomía | 6% | 12 | 24 | 36 | 48 | 60
Orientación a Resultados | 10% | 20 | 40 | 60 | 80 | 100
Planificación y Gestión | 8% | 16 | 32 | 48 | 64 | 80
Mejora Continua | 6% | 12 | 24 | 36 | 48 | 60
Liderazgo | 10% | 20 | 40 | 60 | 80 | 100
Desarrollo del Talento | 8% | 16 | 32 | 48 | 64 | 80
Trabajo en Equipo | 6% | 12 | 24 | 36 | 48 | 60
Comunicación Eficaz | 4% | 8 | 16 | 24 | 32 | 40
Conocimientos Técnicos | 8% | 16 | 32 | 48 | 64 | 80
Resolución de Conflictos | 6% | 12 | 24 | 36 | 48 | 60
Orientación al Cliente | 4% | 8 | 16 | 24 | 32 | 40
Compromiso | 5% | 10 | 20 | 30 | 40 | 50
Flexibilidad - Adaptación | 5% | 10 | 20 | 30 | 40 | 50
TOTAL: 100% / 1000 puntos máximos.

BANDAS SALARIALES:
- Banda A (851-1000 pts): Gerencia. Amplitud sugerida 40%. Lógica de pago: basado en impacto estratégico y bonos por resultados.
- Banda B (651-850 pts): Jefaturas. Amplitud sugerida 30%. Lógica de pago: basado en gestión de equipos y cumplimiento de KPIs.
- Banda C (451-650 pts): Analistas SR. Amplitud sugerida 25%. Lógica de pago: asegurar "gap" del 15% vs. mayor categoría de convenio.
- Banda D (251-450 pts): Analistas/Asistentes. Amplitud sugerida 20%. Lógica de pago: basado en especialización técnica.

Mantenimiento: este manual debe revisarse anualmente o cada vez que un puesto sufra una modificación significativa en sus funciones (mayor al 30%).
--- FIN DEL MANUAL ---`;

const PROMPT_GESTION_TALENTO = `ROL: Actúa como un experto en Gestión del Talento y Desarrollo Organizacional para la empresa Escorial. Tu especialidad es el cruce de datos entre la "Valuación del Puesto" y el "Desempeño Individual".

CONTEXTO Y OBJETIVO:
Ya contamos con una tabla de valuación de puestos por puntos. Tu misión ahora es cruzar esa información con los resultados de las evaluaciones de desempeño de los colaboradores para clasificarlos en dos categorías críticas para Escorial:

PERSONA CLAVE (Continuidad Operativa):
- Foco: Expertise técnico y criticidad del rol.
- Criterio: Personas con puntaje máximo en Conocimiento Técnico y Toma de Decisiones. Si su salida detiene la operación o se pierde conocimiento no documentado, es Clave.

PERSONA DE ALTO POTENCIAL (Crecimiento):
- Foco: Capacidad de aprendizaje y visión sistémica.
- Criterio: Personas cuyo desempeño en Pensamiento Estratégico, Liderazgo e Iniciativa supera los requerimientos del puesto que ocupan actualmente.

TUS TAREAS:
- Recibir y procesar: leerás la tabla de valuación de puestos que el usuario te adjunte.
- Cruzar con Desempeño: cuando te brinden los datos de un colaborador, compararás sus "competencias demostradas" contra los "puntos del puesto".
- Clasificar: determinarás si la persona es un Pilar (Cumple su puesto), una Persona Clave (Crítica) o un Alto Potencial (Ascendible).
- Sugerir Acción: propondrás una acción (ej: "Plan de retención" para Claves o "Plan de sucesión" para Alto Potencial).

FORMATO DE SALIDA:
Por cada persona analizada, entregá un breve informe:
- Nombre/Puesto:
- Puntaje del Puesto vs. Puntaje de la Persona:
- Clasificación Talent Escorial: (Clave / Alto Potencial / Estándar).
- Justificación: por qué encaja en esa definición según los criterios de Escorial.`;

const PROMPT_SELECCION_MATRIZ = `Actúa como un experto en selección y reclutamiento senior. Tu objetivo es realizar una evaluación exhaustiva e imparcial de uno o más Currículums Vitae (CVs) contra la Descripción de Puesto (DP). Debés generar un análisis detallado y presentar los hallazgos en una tabla comparativa clara, visual y fácil de interpretar.

Datos de entrada que el usuario te irá proporcionando (posiblemente en varios mensajes): Descripción de Puesto (DP), CV(s) de Candidato(s) (nombrando claramente a cada uno), Informe(s) de Entrevista por candidato.

Requisitos de la Tarea:

1. Extracción de Criterios Clave: identificá y extraé los 5 Criterios Técnicos más importantes y los 5 Criterios Culturales más importantes de la DP. Estos 10 puntos serán las filas principales de la matriz.

2. Análisis de Candidatos:
 - CV: evaluá la experiencia y habilidades de cada candidato directamente contra los 10 criterios clave extraídos de la DP.
 - Informe de Entrevista: extraé, de manera concisa, por cada candidato: Fortalezas; Riesgos/Puntos de Desarrollo; Motivación (alineación con la DP/empresa); Señales Culturales (alineación con los valores de la empresa/equipo).

3. Matriz Comparativa (tabla markdown):
 - Filas: los 10 Criterios Clave (5 Técnicos, 5 Culturales).
 - Columnas: un bloque de evaluación por cada candidato.
 - Nivel de Ajuste por criterio y candidato: Alto (Verde) = excede o cumple plenamente; Medio (Amarillo) = cumple parcialmente o experiencia transferible; Bajo (Rojo) = carece del requisito o evidencia insuficiente.
 - Contradicciones: en columna separada por candidato, detectá cualquier contradicción entre CV e Informe de Entrevista (o entre partes del informe), citando un ejemplo específico por cada una.

4. Análisis Comparativo (resumen en texto): comparación entre candidatos, destacando quién se ajusta mejor en criterios Técnicos y Culturales, Fortalezas y Riesgos clave de cada uno. Incluí Recomendaciones ("Avanza" / "No Avanzar" / "Avanzar c/observaciones").

Formato de salida: 1) Análisis Comparativo de texto primero. 2) Luego la Matriz Clara y Visual en tabla markdown (usando los niveles [Alto/Medio/Bajo] ya que no hay color real en texto).

Prohibiciones: no inventes información que no aparezca en los documentos presentados; ante duda, preguntá; si no conseguís un dato, colocá "no informado".`;

const PROMPT_TALENT_ACQUISITION = `Actúa como un Senior Technical Recruiter con 15 años de experiencia en selección de personal de diferentes puestos en plantas industriales, desde técnicos a perfiles gerenciales. Tené en cuenta que la empresa en la que te desenvolvés es una empresa familiar de 73 años, metalúrgica, de capital argentino, que fabrica cocinas, termotanques y calefones.

Contexto: el usuario te va a dar una Descripción de Puesto (JD) y currículums (posiblemente en varios mensajes). Tu objetivo es realizar un análisis comparativo crítico para determinar el "fit" de los candidatos. Tenés 2 tareas asignadas:

Tarea 1: Tabla Comparativa
Generá una tabla comparativa (markdown) que incluya a todos los candidatos con las siguientes coincidencias clave:
- Experiencia Técnica Requerida: mapear hard skills específicas.
- Experiencia en Proyectos Similares: identificar ejemplos de proyectos o responsabilidades que demuestren aplicación real de las habilidades del JD.
- Metodologías y Herramientas: coincidencia con metodologías específicas (ej. Scrum, ITIL, PMP) o herramientas de nicho.

Gaps (Brechas) y Riesgos:
- Gaps de Experiencia: identificar áreas donde la experiencia es nula o insuficiente según el JD.
- Riesgos de Fit: señalar la probabilidad de turnover (abandono) o mismatch (desajuste) basándose en la trayectoria del candidato (ej. saltos frecuentes, cambio drástico de rubro).

Evaluación Contextual (Pre-Filtro Humano):
- Seniority vs. Rol: determinar el nivel de seniority percibido (Junior, Semi-Senior, Senior, Lead) y si es adecuado para el JD.
- Tipo de Empresa: comparar si la experiencia previa (Startup, Corporación, PYME, Consultora) se alinea con la cultura/tamaño de la empresa que contrata.
- Idioma: confirmar el nivel de idioma requerido, si aplica (ej. Inglés Fluido/Técnico).
- Competencias Blandas (Soft Skills): inferir y evaluar al menos tres (3) competencias blandas clave (ej. Liderazgo, Comunicación, Adaptabilidad, Resolución de Problemas) basándote en la descripción de roles, logros y responsabilidades del CV.

Tarea 2: Guía de Entrevista Estandarizada
Basándote en los puntos débiles generales encontrados y los requisitos del puesto, redactá una guía de 5 preguntas situacionales (metodología STAR) que permitan nivelar a todos los candidatos por igual.

Formato de salida: presentá la tabla de forma clara (markdown) y luego la guía de preguntas en un listado numerado. Sé directo, honesto y evitá lenguaje genérico.`;

const AGENTES_CHAT = {
    'evaluacion-puntos': {
        nombre: 'Evaluación por Puntos',
        descripcion: 'Valúa puestos fuera de convenio con el método de clasificación por puntos (1000 pts, 15 competencias) y detecta necesidad de cuadros de reemplazo.',
        systemPrompt: `${PROMPT_EVAL_PUNTOS}\n\n${MANUAL_EVALUACION_PUNTOS_TEXTO}`
    },
    'gestion-talento': {
        nombre: 'Gestión del Talento',
        descripcion: 'Cruza la valuación de puestos con el desempeño individual para identificar Personas Clave y de Alto Potencial.',
        systemPrompt: PROMPT_GESTION_TALENTO
    },
    'seleccion-matriz': {
        nombre: 'Selección — Matriz Comparativa',
        descripcion: 'Compara CVs e informes de entrevista contra una Descripción de Puesto en una matriz visual por criterios técnicos y culturales.',
        systemPrompt: PROMPT_SELECCION_MATRIZ
    },
    'talent-acquisition': {
        nombre: 'Talent Acquisition',
        descripcion: 'Análisis crítico de fit técnico/cultural entre candidatos y una Descripción de Puesto, con guía de entrevista STAR.',
        systemPrompt: PROMPT_TALENT_ACQUISITION
    }
};

async function requireRRHH(req, res) {
    const ok = await perteneceGrupo({ username: req.user.username, grupousuario: "'rrhh'" });
    if (!ok) {
        res.status(403).json({ error: "Acceso exclusivo para RRHH" });
        return false;
    }
    return true;
}

const uploadChatArchivos = multer({ storage: multer.memoryStorage() });

// Extrae el contenido de un archivo adjunto (PDF) como bloques de contenido para el input de OpenAI,
// y devuelve también el texto plano (para persistir y poder reconstruir el historial en turnos futuros).
async function procesarArchivoChat(file) {
    const textoPdf = await parsePdfBuffer(file.buffer).catch(() => '');
    if (textoPdf.trim().length >= 40) {
        return {
            textoExtraido: textoPdf,
            contenido: [{ type: "input_text", text: `--- Documento adjunto: ${file.originalname} ---\n${textoPdf}` }]
        };
    }
    // PDF escaneado / sin texto extraíble: se procesa como imágenes solo para este turno.
    const paginas = await pdfToPng(file.buffer, { viewportScale: 2.0, disableFontFace: true });
    return {
        textoExtraido: null,
        contenido: [
            { type: "input_text", text: `--- Documento adjunto (imágenes): ${file.originalname} ---` },
            ...paginas.map(p => ({ type: "input_image", image_url: `data:image/png;base64,${p.content.toString('base64')}` }))
        ]
    };
}

app.get("/chat-agentes", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const lista = Object.entries(AGENTES_CHAT).map(([key, a]) => ({ key, nombre: a.nombre, descripcion: a.descripcion }));
        res.json(lista);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo agentes" });
    }
});

app.get("/chat-conversaciones", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const { agente_key } = req.query;
        const params = [req.user.username];
        let where = "usuario = $1";
        if (agente_key) {
            params.push(agente_key);
            where += " AND agente_key = $2";
        }
        const result = await pool.query(
            `SELECT id, agente_key, titulo, fecha_creacion, fecha_actualizacion FROM web.chat_agente_conversacion WHERE ${where} ORDER BY fecha_actualizacion DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo conversaciones" });
    }
});

app.post("/chat-conversaciones", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const { agente_key, titulo } = req.body;
        if (!agente_key || !AGENTES_CHAT[agente_key]) {
            return res.status(400).json({ error: "agente_key inválido" });
        }
        const id = require('crypto').randomUUID();
        const result = await pool.query(
            `INSERT INTO web.chat_agente_conversacion (id, agente_key, usuario, titulo, fecha_creacion, fecha_actualizacion)
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
            [id, agente_key, req.user.username, titulo || AGENTES_CHAT[agente_key].nombre]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error creando conversación" });
    }
});

app.get("/chat-conversaciones/:id", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const conv = await pool.query(
            "SELECT * FROM web.chat_agente_conversacion WHERE id = $1 AND usuario = $2",
            [req.params.id, req.user.username]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: "Conversación no encontrada" });

        const mensajes = await pool.query(
            "SELECT id, rol, contenido, fecha FROM web.chat_agente_mensaje WHERE conversacion_id = $1 ORDER BY fecha ASC",
            [req.params.id]
        );
        const archivos = await pool.query(
            `SELECT id, mensaje_id, nombre_archivo, mime_type, fecha FROM web.chat_agente_archivo
             WHERE mensaje_id IN (SELECT id FROM web.chat_agente_mensaje WHERE conversacion_id = $1)`,
            [req.params.id]
        );
        const archivosPorMensaje = archivos.rows.reduce((acc, a) => {
            (acc[a.mensaje_id] = acc[a.mensaje_id] || []).push(a);
            return acc;
        }, {});

        res.json({
            conversacion: conv.rows[0],
            mensajes: mensajes.rows.map(m => ({ ...m, archivos: archivosPorMensaje[m.id] || [] }))
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error obteniendo conversación" });
    }
});

app.delete("/chat-conversaciones/:id", passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        await pool.query(
            "DELETE FROM web.chat_agente_conversacion WHERE id = $1 AND usuario = $2",
            [req.params.id, req.user.username]
        );
        res.sendStatus(200);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error eliminando conversación" });
    }
});

app.post("/chat-conversaciones/:id/mensajes", passport.authenticate('jwt', { session: false }), uploadChatArchivos.array('archivos'), async (req, res) => {
    try {
        if (!(await requireRRHH(req, res))) return;
        const conv = await pool.query(
            "SELECT * FROM web.chat_agente_conversacion WHERE id = $1 AND usuario = $2",
            [req.params.id, req.user.username]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: "Conversación no encontrada" });
        const conversacion = conv.rows[0];
        const agente = AGENTES_CHAT[conversacion.agente_key];
        if (!agente) return res.status(400).json({ error: "Agente inválido para esta conversación" });

        const contenidoUsuario = req.body.contenido || '';
        const archivos = req.files || [];

        // Procesa los adjuntos de este turno (texto o imágenes según corresponda).
        const archivosProcesados = await Promise.all(archivos.map(async file => ({
            file,
            ...(await procesarArchivoChat(file))
        })));

        // Reconstruye el historial completo (store:false => sin estado en OpenAI, se arma todo el input cada vez).
        const historial = await pool.query(
            `SELECT m.id, m.rol, m.contenido, a.nombre_archivo, a.texto_extraido
             FROM web.chat_agente_mensaje m
             LEFT JOIN web.chat_agente_archivo a ON a.mensaje_id = m.id
             WHERE m.conversacion_id = $1 ORDER BY m.fecha ASC`,
            [req.params.id]
        );

        const mensajesPorId = new Map();
        for (const row of historial.rows) {
            if (!mensajesPorId.has(row.id)) {
                mensajesPorId.set(row.id, { rol: row.rol, contenido: row.contenido, archivos: [] });
            }
            if (row.nombre_archivo) {
                mensajesPorId.get(row.id).archivos.push({ nombre_archivo: row.nombre_archivo, texto_extraido: row.texto_extraido });
            }
        }

        const inputHistorial = Array.from(mensajesPorId.values()).map(m => {
            const tipoTexto = m.rol === 'assistant' ? 'output_text' : 'input_text';
            const content = [{ type: tipoTexto, text: m.contenido || '' }];
            if (m.rol === 'user') {
                for (const a of m.archivos) {
                    content.push({
                        type: 'input_text',
                        text: a.texto_extraido
                            ? `--- Documento adjunto: ${a.nombre_archivo} ---\n${a.texto_extraido}`
                            : `--- Documento adjunto: ${a.nombre_archivo} (contenido no extraíble como texto) ---`
                    });
                }
            }
            return { role: m.rol, content };
        });

        const contenidoTurnoActual = [
            { type: "input_text", text: contenidoUsuario },
            ...archivosProcesados.flatMap(a => a.contenido)
        ];

        const openai = new OpenAI({ apiKey: process.env.OPENAI_ASISTENTESRRHH_KEY });
        const aiResponse = await openai.responses.create({
            model: "gpt-4.1",
            input: [
                { role: "system", content: [{ type: "input_text", text: agente.systemPrompt }] },
                ...inputHistorial,
                { role: "user", content: contenidoTurnoActual }
            ],
            temperature: 0.3,
            max_output_tokens: 4096,
            store: false
        });

        const respuestaTexto = aiResponse.output_text || '';

        // Persistir mensaje de usuario + archivos adjuntos
        const mensajeUsuarioId = require('crypto').randomUUID();
        await pool.query(
            "INSERT INTO web.chat_agente_mensaje (id, conversacion_id, rol, contenido, fecha) VALUES ($1, $2, 'user', $3, NOW())",
            [mensajeUsuarioId, req.params.id, contenidoUsuario]
        );
        for (const a of archivosProcesados) {
            await pool.query(
                `INSERT INTO web.chat_agente_archivo (id, mensaje_id, nombre_archivo, mime_type, archivo, texto_extraido, fecha)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [require('crypto').randomUUID(), mensajeUsuarioId, a.file.originalname, a.file.mimetype, a.file.buffer, a.textoExtraido]
            );
        }

        // Persistir respuesta del asistente
        const mensajeAsistenteId = require('crypto').randomUUID();
        await pool.query(
            "INSERT INTO web.chat_agente_mensaje (id, conversacion_id, rol, contenido, fecha) VALUES ($1, $2, 'assistant', $3, NOW())",
            [mensajeAsistenteId, req.params.id, respuestaTexto]
        );

        await pool.query(
            "UPDATE web.chat_agente_conversacion SET fecha_actualizacion = NOW() WHERE id = $1",
            [req.params.id]
        );

        res.json({
            mensaje_usuario: { id: mensajeUsuarioId, rol: 'user', contenido: contenidoUsuario, archivos: archivosProcesados.map(a => ({ nombre_archivo: a.file.originalname, mime_type: a.file.mimetype })) },
            mensaje_asistente: { id: mensajeAsistenteId, rol: 'assistant', contenido: respuestaTexto, archivos: [] }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Error procesando el mensaje" });
    }
});

/* PUERTO */

if (require.main === module) {
    app.listen(process.env.PORT, () => {
        console.log("Server has started on port "+process.env.PORT)
    });
}