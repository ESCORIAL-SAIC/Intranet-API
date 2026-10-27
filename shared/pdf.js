const PdfReader = require('pdfreader').PdfReader;

/**
 * Extrae el texto plano de un PDF (buffer) usando pdfreader.
 * Usado por reclutamiento, capacitacion, conclave, cvs y chat-agentes
 * para leer descripciones de puesto / CVs / documentos adjuntos.
 */
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

module.exports = { parsePdfBuffer };
