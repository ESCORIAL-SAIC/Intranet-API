
const express = require("express");
const app = express();
const cors = require("cors");
const flash = require("express-flash")
const passport = require("passport")

require("dotenv").config();

require('./config/passportJWT')

app.use(cors());
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(passport.initialize())

app.use(flash())

app.use(require('./modules/auth/auth.routes'));
app.use(require('./modules/dashboard/dashboard.routes'));
app.use(require('./modules/explorador/explorador.routes'));
app.use(require('./modules/evaluaciones-desempenio/evaluaciones-desempenio.routes'));
app.use(require('./modules/estudios/estudios.routes'));
app.use(require('./modules/empleados/empleados.routes'));
app.use(require('./modules/reclutamiento/reclutamiento.routes'));
app.use(require('./modules/capacitacion/capacitacion.routes'));
app.use(require('./modules/conclave/conclave.routes'));
app.use(require('./modules/objetivos-gerencias/objetivos-gerencias.routes'));
app.use(require('./modules/objetivos-anuales/objetivos-anuales.routes'));
app.use(require('./modules/nuevebox/nuevebox.routes'));
app.use(require('./modules/genoma/genoma.routes'));
app.use(require('./modules/cvs/cvs.routes'));
app.use(require('./modules/chat-agentes/chat-agentes.routes'));

/* PUERTO */

if (require.main === module) {
    app.listen(process.env.PORT, () => {
        console.log("Server has started on port "+process.env.PORT)
    });
}

module.exports = app;
