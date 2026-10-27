const express = require("express");
const fs = require("fs");
const path = require('path');
const { parse } = require('csv-parse/sync');
const PdfReader = require('pdfreader').PdfReader;
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");
const { getOpenAIClient } = require("../../config/openai");
const { parsePdfBuffer } = require("../../shared/pdf");

const router = express.Router();

/* OPENAI - SELECCION DE PERSONAL */

router.get("/requerimiento-personal", requireAuth, async(req, res) => {
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

router.get('/organigrama', requireAuth, async(req, res) => {
  //const { gerencia, format } = req.query;
  const gerencia = await buscaGerencia(req.user.username)
  if (!gerencia) {
    return res.status(400).json({ error: 'No se encontró gerencia para el usuario' });
  }

  try {
    console.log(`[ORGANIGRAMA] Iniciando búsqueda para gerencia: ${gerencia}`);

    // Leer el CSV maestro desde el servidor
    const csvPath = path.join(__dirname, '../../data/organigrama_completo.csv');
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

router.post("/entrevistador", requireAuth, async(req, res) => {
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

        const openai = getOpenAIClient('OPENAI_API_KEY');


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

// router.get("/entrevistador-requerimiento", requireAuth, async(req, res) => {
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


router.get("/entrevistador-requerimiento", requireAuth, async(req, res) => {
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

        const openai = getOpenAIClient('OPENAI_API_KEY');

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

module.exports = router;
