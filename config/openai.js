const OpenAI = require("openai");

/**
 * El servidor usa distintas API keys de OpenAI según el módulo/producto:
 *   - OPENAI_API_KEY             -> selección de personal, entrevistador, chat-agentes, cvs
 *   - OPENAI_JSONB_API_KEY       -> plan de capacitación
 *   - OPENAI_GENOMA_API_KEY      -> genoma
 *   - OPENAI_ASISTENTESRRHH_KEY  -> chat-agentes (asistente RRHH)
 *
 * Antes cada endpoint instanciaba `new OpenAI({ apiKey: process.env.X })` inline.
 * Se centraliza acá para no repetir el patrón y cachear el cliente por env var
 * (evita crear una instancia nueva en cada request).
 */
const clients = new Map();

function getOpenAIClient(envVarName) {
    if (!clients.has(envVarName)) {
        clients.set(envVarName, new OpenAI({ apiKey: process.env[envVarName] }));
    }
    return clients.get(envVarName);
}

module.exports = { getOpenAIClient };
