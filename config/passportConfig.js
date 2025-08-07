const LocalStrategy = require("passport-local").Strategy;
const { pool } = require("./db");
const bcrypt = require("bcrypt");

function initialize(passport){
    debugger
    passport.use(new LocalStrategy(
        function (username, pass, done) {
            pool.query("select id, username, password from v_intranet_usuarios where username = '"+ username + "'", (err, results)=>{
                if(err){
                    throw err;
                }

                if (results.rows.length > 0){
                    const user = results.rows[0]

                    if(pass == user.password){
                        return done(null,user);
                    }else{
                        return done(null, false, {message: "Contraseña Incorrecta"});
                    }
                } 
                else{
                    return done(null, false, {message: "Usuario no existe"})
                } 
            })
        }
    ))

    passport.serializeUser((user,done) => done(null, user.id))
    
    passport.deserializeUser((id,done)=>{
        pool.query("select * from v_intranet_usuarios where id = '{" +id +"}'", (err, results)=>{
            if (err) {
                throw err;
            }
            return done(null, results.rows[0])
        })
    })
}

module.exports = initialize;