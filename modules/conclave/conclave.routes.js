const express = require("express");
const fs = require("fs");
const path = require('path');
const { pool } = require("../../config/db");
const { getOpenAIClient } = require("../../config/openai");
const { parsePdfBuffer } = require("../../shared/pdf");

const router = express.Router();

// Ruta principal
router.post("/enviar-data-storage-conclave", async (req, res) => {
  try {
    const openai = getOpenAIClient('OPENAI_API_KEY');

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
    const filePath = path.join(__dirname, "../..", "files", "empleados.json");
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

module.exports = router;
