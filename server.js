
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
        const allDatas = await pool.query("select * from web.v_intranet_eventos where not (dia::int >= 17 and dia::int <= 28 and mes = 'FEB') limit 3")
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
            SELECT Z.cuestionario_id,Z.usuario_evaluar,Z.tipo,Z.fechadesde,Z.fechahasta FROM web.v_intranet_desemp_pend Z WHERE ((Z.USUARIO_SISTEMA = $1 AND NOT EXISTS (SELECT 1 FROM	web.intranet_registro_eval_desemp qb WHERE qb.usuario_evaluar = $1 and  qb.usuario = $1) AND PERMITE_AUTOEVALUACION <> FALSE ) OR (Z.usuario_sistema1 = $1 AND not exists (select 1 from web.intranet_registro_eval_desemp qb where qb.cuestionario_id = Z.cuestionario_id and (((qb.usuario = $1 and qb.usuario_evaluar = Z.USUARIO_SISTEMA))))) ) AND Z.cuestionario_id = $2 and Z.usuario_evaluar = $3
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
        select usuario_evaluar from web.intranet_registro_eval_desemp re where re.id = $1
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
        query = "select * from web.v_intranet_eval_desemp_completas"
        
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



/* OPENAI - SELECCION DE PERSONAL */

app.get("/requerimiento-personal", passport.authenticate('jwt', { session: false }), async(req, res) => {
    try {
        
        let query = ""
        let params = []

        if(req.headers.requerimiento != undefined){                 
            query = "SELECT * FROM web.v_intranet_requerimiento_personal_colaboradores where id = $1"
            params = [req.headers.requerimiento]
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
            query = "select id, tipo, numero, nombre, puesto, gerencia, sector, detalle, fecha, estado from web.v_intranet_requerimiento_personal"
            const allDatas = await pool.query(query,params)
            res.json(allDatas.rows)
        }

    } catch (err) {
        console.log(err)
    }
})

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
        for (const row of allDatas.rows) {
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

        //Compruebo si hay colaboradores previos registrados
        
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
                "text": `
                    Eres un reclutador profesional de recursos humanos, encargado de la selección de posibles entrevistadores que pertenecen a la empresa (esos candidatos se obtienen de la información depositada en el vector store) que posteriormente entrevistaran a posibles candidatos. El posible candidato se determina a través de qué tan similar y compatible es el puesto del empleado en comparación al puesto vacante del cual se entrevistarán los candidatos. Debes elegir las cinco mejores opciones en orden de mejor opción (si es posible, sino elegir menos de 5 y nunca decir personas que no se encuentren en el vector store o nombradas previamente). 
                    Además, hay casos excepcionales:
                    Jefes(Puesto Requerido) = 2 gerentes + 3 jefes (colaboradores priorizados)
                    Jefaturas clave (Mantenimiento, UET) = 3 gerentes + Nicolas Krecul + Bruno Passaglia + Jorge Viturro (colaboradores priorizados)
                    KAM (Puesto Requerido) = 3 gerentes 2 jefes (colaboradores priorizados)
                    Gerentes (Puesto Requerido) = 4 Gerentes + Jorge Viturro (colaboradores priorizados)
                    Se debe devolver únicamente un json que contenga el nombre y descripción del puesto vacante además de un array con el json de cada colaborador elegido, el formato del json de cada colaborador será el siguiente: { "empleado_id", "empleado",  "legajo", "puesto, "sector"}
                    El resultado final debería enviarse de la siguiente manera:
                    {
                    "nombre_puesto_vacante",  
                    "descripcion_puesto_vacante",
                    “candidatos”:[
                        { "empleado_id", "empleado",  "legajo", "puesto, "sector"},
                        { "empleado_id", "empleado",  "legajo", "puesto, "sector"}
                    ]
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
                "text": "Descripcion de puesto vacante: " + puestoReqPrompt 
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
            tools: [
                {
                "type": "file_search",
                "vector_store_ids": [ process.env.OPENAI_VECTOR_ID ]
                }
            ],
            temperature: 1,
            max_output_tokens: 2048,
            top_p: 1,
            store: true
            });

            const parsedOutput = typeof response.output_text === "string"
                ? JSON.parse(response.output_text)
                : response.output_text;

            if (parsedOutput?.candidatos?.length) {
                await Promise.all(
                    parsedOutput.candidatos
                        .filter(resp => resp.empleado_id && resp.empleado_id !== "vacio")
                        .map(resp =>
                            altaEntrevistadores(req.headers.requerimiento, resp.empleado_id)
                        )
                );
            }

            //Consulto a la bd los colaboradores insertados
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

            //res.json(JSON.parse(response.output_text));

    } catch (err) {
        console.log(err)
    }
})


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

                Recursos/Herramientas Sugeridas: Menciona plataformas, personas (mentores) o herramientas que podrían ser útiles para la capacitación.

                Plazo Sugerido: Indica un marco de tiempo realista para completar la capacitación (ej. "30 días", "próximo trimestre").

                Formato de Salida:

                Comienza con un resumen ejecutivo que presente las principales conclusiones del análisis.

                Luego, presenta el plan de capacitación en la tabla detallada.

                Finaliza con un párrafo de recomendaciones adicionales y un mensaje motivacional para el colaborador, destacando la importancia de este plan para su crecimiento profesional.
                
                Devuelve la información en formato JSON válido

                Formato JSON:

                {
                    "resumen_ejecutivo":,
                    "plan_capacitacion":[
                        {
                            "area_mejora":,
                            "brecha_identificada",
                            "objetivo_capacitacion",
                            "acciones_recomendadas":,
                            "recursos_sugeridos":,
                            "plazo_sugerido":,
                        }
                    ],
                    "recomendaciones_finales":,
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
                "text": "Empleado id a analizar: " + empleado_id  
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
            tools: [
                {
                "type": "file_search",
                "vector_store_ids": [ process.env.OPENAI_CAP_VECTOR_ID ]
                }
            ],
            temperature: 1,
            max_output_tokens: 2048,
            top_p: 1,
            store: true
            });

            const parsedOutput = typeof response.output_text === "string"
                ? JSON.parse(response.output_text)
                : response.output_text;

            altaPlanCapacitacion(parsedOutput, empleado_id)

            res.json(parsedOutput);
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
      empleados.push({
        empleado_id: row.empleado_id,
        empleado: row.empleado,
        puesto: row.puesto,
        legajo: row.legajo,
        sector: row.sector,
        puesto_pdf: texto,
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

async function altaEntrevistadores(requerimiento, empleado){
    try {
        await pool.query("insert into web.intranet_registros_colaboradores_propuestos (requerimiento_personal_id , empleado_id) values($1, $2)", [requerimiento, empleado])
    } catch(err){
        res.status(500).json({ error: "Error procesando el archivo o conectando con OpenAI." });
        console.log(err)
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

/* PUERTO */

app.listen(process.env.PORT, () => {
    console.log("Server has started on port "+process.env.PORT)
});