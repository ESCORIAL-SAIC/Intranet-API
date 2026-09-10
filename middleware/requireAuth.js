const passport = require("passport");

/**
 * Middleware de autenticación JWT usado por casi todos los endpoints privados.
 * Antes estaba repetido inline (`passport.authenticate('jwt', { session: false })`)
 * en cada ruta de server.js; se centraliza acá para no duplicar el string y
 * para tener un único lugar donde ajustar la estrategia de auth si cambia.
 */
const requireAuth = passport.authenticate("jwt", { session: false });

module.exports = requireAuth;
