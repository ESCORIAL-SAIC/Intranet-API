const OpenAI = require("openai");

/**
 * El servidor usa distintas API keys de OpenAI según el módulo/producto:
 *   - OPENAI_API_KEY             -> selección de personal, entrevistador, chat-agentes, cvs
 *   - OPENAI_CAP_API_KEY         -> plan de capacitación
 *   - OPENAI_GENOMA_API_KEY      -> genoma
 *   - OPENAI_ASISTENTESRRHH_KEY  -> chat-agentes (asistente RRHH)
 *
 * Antes cada endpoint instanciaba `new OpenAI({ apiKey: process.env.X })` inline.
 * Se centraliza acá para no repetir el patrón y cachear el cliente por env var
 * (evita crear una instancia nueva en cada request).
 *
 * Nota: en el .env actual la variable se llama OPENAI_JSONB_API_KEY, no
 * OPENAI_CAP_API_KEY como referencia el código — son cosas que había que
 * revisar aparte, no se tocaron acá para no cambiar comportamiento.
 */
const clients = new Map();

function getOpenAIClient(envVarName) {
    if (!clients.has(envVarName)) {
        clients.set(envVarName, new OpenAI({ apiKey: process.env[envVarName] }));
    }
    return clients.get(envVarName);
}

module.exports = { getOpenAIClient };
