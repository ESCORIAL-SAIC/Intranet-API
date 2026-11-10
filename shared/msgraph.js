// Cliente mínimo de Microsoft Graph con credenciales de aplicación (client credentials).
// Requiere en .env: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET (app registrada en
// Entra ID). Si falta alguna, graphHabilitado() devuelve false y los módulos que lo usan deben
// seguir funcionando sin la integración.

const GRAPH_URL = 'https://graph.microsoft.com/v1.0';

let tokenCache = { valor: null, expira: 0 };

function graphHabilitado() {
    return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

async function obtenerToken() {
    if (tokenCache.valor && Date.now() < tokenCache.expira) return tokenCache.valor;

    const respuesta = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GRAPH_CLIENT_ID,
            client_secret: process.env.GRAPH_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
        }),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) {
        throw new Error(`Graph: no se pudo obtener el token (${datos.error_description || datos.error || respuesta.status})`);
    }
    // Se renueva 5 minutos antes de que venza.
    tokenCache = { valor: datos.access_token, expira: Date.now() + (datos.expires_in - 300) * 1000 };
    return tokenCache.valor;
}

// Llamada a Graph. ruta relativa a /v1.0 (ej. '/users/x/events'). Devuelve el JSON (o null si
// la respuesta no tiene cuerpo) y lanza un Error con el mensaje de Graph si falla.
async function graph(metodo, ruta, cuerpo, headersExtra = {}) {
    const token = await obtenerToken();
    const respuesta = await fetch(`${GRAPH_URL}${ruta}`, {
        method: metodo,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...headersExtra,
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (respuesta.status === 204) return null;
    const texto = await respuesta.text();
    const datos = texto ? JSON.parse(texto) : null;
    if (!respuesta.ok) {
        const mensaje = datos && datos.error ? `${datos.error.code}: ${datos.error.message}` : `HTTP ${respuesta.status}`;
        const error = new Error(`Graph: ${mensaje}`);
        error.status = respuesta.status;
        throw error;
    }
    return datos;
}

module.exports = { graphHabilitado, graph };
