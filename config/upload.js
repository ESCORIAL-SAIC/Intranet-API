const multer = require("multer");

/**
 * Instancias de multer usadas por los endpoints de carga de archivos.
 * Las tres usaban exactamente la misma configuración (memoryStorage, sin
 * límites ni fileFilter) repetida inline en server.js; se centralizan acá
 * con el mismo nombre que tenían para que el diff de migración sea mínimo.
 */
const uploadGenoma = multer({ storage: multer.memoryStorage() });
const uploadCV = multer({ storage: multer.memoryStorage() });
const uploadChatArchivos = multer({ storage: multer.memoryStorage() });

module.exports = { uploadGenoma, uploadCV, uploadChatArchivos };
