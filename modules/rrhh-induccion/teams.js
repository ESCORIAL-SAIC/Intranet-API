const { graphHabilitado, graph } = require("../../shared/msgraph");

/* Reuniones de Teams para las inducciones (Microsoft Graph).
   Por cada inducción con fecha y horario de un roadmap publicado se crea un evento de calendario
   con reunión de Teams en la casilla organizadora, invitando a RRHH (el colaborador a inducir no
   se invita). Si RRHH eligió una sala y está libre en ese horario se la agrega como recurso;
   si está ocupada, la reunión queda solo por Teams.

   Configuración (.env):
     GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET  app de Entra ID (ver shared/msgraph.js)
     TEAMS_ORGANIZADOR      casilla que organiza las reuniones, ej. rrhh@escorial.com.ar
     TEAMS_ASISTENTES_RRHH  emails invitados, separados por coma
     TEAMS_SALAS            opcional, "Nombre|email;Nombre|email". Si no está, se listan las salas
                            de Microsoft 365 (GET /places/microsoft.graph.room)
     TEAMS_ZONA_HORARIA     opcional, por defecto "Argentina Standard Time"
   Sin GRAPH_* o TEAMS_ORGANIZADOR la integración queda desactivada y no se llama a Graph. */

const ZONA_HORARIA = () => process.env.TEAMS_ZONA_HORARIA || 'Argentina Standard Time';
const organizador = () => (process.env.TEAMS_ORGANIZADOR || '').trim();

function teamsHabilitado() {
    return graphHabilitado() && !!organizador();
}

function asistentesRRHH() {
    return (process.env.TEAMS_ASISTENTES_RRHH || '')
        .split(',').map(e => e.trim()).filter(Boolean);
}

/* ===================================== SALAS ===================================== */

let salasCache = { valor: null, expira: 0 };

async function listarSalas() {
    if (process.env.TEAMS_SALAS) {
        return process.env.TEAMS_SALAS.split(';').map(s => s.trim()).filter(Boolean).map(s => {
            const [nombre, email] = s.split('|').map(x => x.trim());
            return { nombre, email: (email || '').toLowerCase(), capacidad: null };
        }).filter(s => s.email);
    }
    if (salasCache.valor && Date.now() < salasCache.expira) return salasCache.valor;
    const datos = await graph('GET', '/places/microsoft.graph.room?$top=100');
    const salas = (datos.value || [])
        .map(s => ({ nombre: s.displayName, email: (s.emailAddress || '').toLowerCase(), capacidad: s.capacity || null }))
        .filter(s => s.email)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    salasCache = { valor: salas, expira: Date.now() + 10 * 60 * 1000 };
    return salas;
}

/* ===================================== HORARIOS ===================================== */

function pad(n) { return String(n).padStart(2, '0'); }

// Inicio/fin como hora de pared 'YYYY-MM-DDTHH:MM:00' (Graph recibe la zona horaria aparte).
function calcularSlot(fecha, horario, duracionMin) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [hora, minuto] = horario.split(':').map(Number);
    const inicio = new Date(anio, mes - 1, dia, hora, minuto);
    const fin = new Date(inicio.getTime() + (parseInt(duracionMin, 10) || 30) * 60000);
    const formato = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    return { inicio: formato(inicio), fin: formato(fin) };
}

// Disponibilidad de salas en un horario: { [email]: true | false | null (no se pudo verificar) }.
// ignorar = { email, inicio, fin }: reserva propia (la de la misma inducción) que no cuenta como ocupación.
async function disponibilidadSalas(emails, slot, ignorar = null) {
    if (emails.length === 0) return {};
    const datos = await graph('POST', `/users/${encodeURIComponent(organizador())}/calendar/getSchedule`, {
        schedules: emails,
        startTime: { dateTime: slot.inicio, timeZone: ZONA_HORARIA() },
        endTime: { dateTime: slot.fin, timeZone: ZONA_HORARIA() },
        availabilityViewInterval: 15,
    }, { Prefer: `outlook.timezone="${ZONA_HORARIA()}"` });

    const resultado = {};
    for (const agenda of datos.value || []) {
        const email = (agenda.scheduleId || '').toLowerCase();
        if (agenda.error) { resultado[email] = null; continue; }
        const ocupada = (agenda.scheduleItems || []).some(item => {
            if (item.status === 'free') return false;
            const inicio = item.start.dateTime.substring(0, 16) + ':00';
            const fin = item.end.dateTime.substring(0, 16) + ':00';
            if (!(inicio < slot.fin && fin > slot.inicio)) return false;
            const esPropia = ignorar && ignorar.email === email && ignorar.inicio === inicio && ignorar.fin === fin;
            return !esPropia;
        });
        resultado[email] = !ocupada;
    }
    return resultado;
}

/* ===================================== EVENTOS ===================================== */

function escaparHtml(texto) {
    return String(texto || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function cuerpoEvento(roadmap, item, slot, sala) {
    const lineas = [
        `<p><strong>Inducción:</strong> ${escaparHtml(item.nombre)}</p>`,
        `<p><strong>Colaborador:</strong> ${escaparHtml(roadmap.nombre_snapshot)}${roadmap.puesto_snapshot ? ` — ${escaparHtml(roadmap.puesto_snapshot)}` : ''}</p>`,
        item.facilitador ? `<p><strong>Facilitador:</strong> ${escaparHtml(item.facilitador)}</p>` : '',
        item.observaciones ? `<p>${escaparHtml(item.observaciones)}</p>` : '',
        '<p><em>Reunión generada automáticamente desde la Intranet (RRHH · Inducción).</em></p>',
    ];
    const asistentes = asistentesRRHH().map(email => ({ emailAddress: { address: email }, type: 'required' }));
    if (sala) asistentes.push({ emailAddress: { address: sala.email, name: sala.nombre }, type: 'resource' });

    return {
        subject: `Inducción: ${item.nombre} — ${roadmap.nombre_snapshot}`,
        body: { contentType: 'HTML', content: lineas.join('') },
        start: { dateTime: slot.inicio, timeZone: ZONA_HORARIA() },
        end: { dateTime: slot.fin, timeZone: ZONA_HORARIA() },
        location: sala
            ? { displayName: sala.nombre, locationEmailAddress: sala.email, locationType: 'conferenceRoom' }
            : { displayName: 'Microsoft Teams' },
        attendees: asistentes,
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
        allowNewTimeProposals: false,
    };
}

// Cancela la reunión (Graph envía la cancelación a los invitados). Un evento ya borrado no es error.
async function cancelarEvento(eventId) {
    if (!eventId || !teamsHabilitado()) return;
    try {
        await graph('DELETE', `/users/${encodeURIComponent(organizador())}/events/${encodeURIComponent(eventId)}`);
    } catch (err) {
        if (err.status !== 404) throw err;
    }
}

// Crea o actualiza la reunión de una inducción. Devuelve los campos teams_* / sala a guardar en
// web.induccion_roadmap_item. teams_sync guarda lo último sincronizado para no repetir llamadas.
async function sincronizarItem(roadmap, item) {
    const slot = calcularSlot(item.fecha, item.horario, item.duracion_min);
    const salaPedida = item.sala_email ? { email: item.sala_email.toLowerCase(), nombre: item.sala_nombre || item.sala_email } : null;
    const deseado = {
        inicio: slot.inicio, fin: slot.fin, nombre: item.nombre, colaborador: roadmap.nombre_snapshot,
        facilitador: item.facilitador || null, observaciones: item.observaciones || null,
        sala_email: salaPedida ? salaPedida.email : null,
        organizador: organizador(), asistentes: asistentesRRHH(),
    };
    const anterior = item.teams_sync || null;
    // Campo por campo: jsonb no conserva el orden de las claves.
    const sinCambios = anterior && Object.keys(deseado).every(k => JSON.stringify(anterior[k]) === JSON.stringify(deseado[k]));
    if (item.teams_event_id && !item.teams_error && sinCambios) {
        return null;
    }

    // Sala: se agrega solo si está libre (sin contar la reserva que ya tenía esta misma inducción).
    let sala = null;
    let salaEstado = null;
    if (salaPedida) {
        const yaReservada = anterior && anterior.sala_reservada && anterior.sala_email === salaPedida.email;
        const mismoHorario = anterior && anterior.inicio === slot.inicio && anterior.fin === slot.fin;
        if (yaReservada && mismoHorario) {
            sala = salaPedida;
            salaEstado = 'reservada';
        } else {
            const ignorar = yaReservada ? { email: salaPedida.email, inicio: anterior.inicio, fin: anterior.fin } : null;
            const disponibilidad = await disponibilidadSalas([salaPedida.email], slot, ignorar);
            const disponible = disponibilidad[salaPedida.email];
            if (disponible === false) {
                salaEstado = 'no_disponible';
            } else {
                sala = salaPedida;
                salaEstado = disponible === true ? 'reservada' : 'sin_verificar';
            }
        }
    }

    const cuerpo = cuerpoEvento(roadmap, item, slot, sala);
    const base = `/users/${encodeURIComponent(organizador())}/events`;
    let evento = null;
    if (item.teams_event_id) {
        try {
            evento = await graph('PATCH', `${base}/${encodeURIComponent(item.teams_event_id)}`, cuerpo);
        } catch (err) {
            if (err.status !== 404) throw err; // el evento se borró a mano: se crea de nuevo
        }
    }
    if (!evento) evento = await graph('POST', base, cuerpo);

    return {
        teams_event_id: evento.id,
        teams_join_url: (evento.onlineMeeting && evento.onlineMeeting.joinUrl) || item.teams_join_url || null,
        teams_sala_estado: salaEstado,
        teams_sync: { ...deseado, sala_reservada: !!sala },
        teams_error: null,
    };
}

module.exports = { teamsHabilitado, listarSalas, disponibilidadSalas, calcularSlot, sincronizarItem, cancelarEvento };
