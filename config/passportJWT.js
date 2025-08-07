const JwtStrategy = require('passport-jwt').Strategy,
    ExtractJwt = require('passport-jwt').ExtractJwt;
const opts = {}
const passport = require('passport')
const { pool } = require("./db");

opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
opts.secretOrKey = 'Random string';

passport.use(new JwtStrategy(opts, function (jwt_payload, done) {
    pool.query("select id, username, password from web.v_intranet_usuarios where id = '"+ jwt_payload.id + "'", (err, user)=>{
        if (err) {
            return done(err, false);
        }
        if (user) {
            return done(null, user.rows[0]);
        } else {
            return done(null, false);
        }
    });
}));