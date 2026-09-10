const express = require("express");
const fs = require("fs");
const path = require('path');
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { getOpenAIClient } = require("../../config/openai");
const { parsePdfBuffer } = require("../../shared/pdf");

const router = express.Router();

/* PLAN DE CAPACITACION CON IA */

router.get("/plan-capacitacion", requireAuth, async(req, res) => {
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

router.get("/obtener-plan-capacitacion", requireAuth, async(req, res) => {
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

        const openai = getOpenAIClient('OPENAI_JSONB_API_KEY');

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


        const openaiJSON = getOpenAIClient('OPENAI_JSONB_API_KEY');

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

// Ruta principal
router.post("/enviar-data-storage-capacitacion", async (req, res) => {
  try {
    const openai = getOpenAIClient('OPENAI_JSONB_API_KEY');

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
    const filePath = path.join(__dirname, "../..", "files", "empleados-cap.json");
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

module.exports = router;
