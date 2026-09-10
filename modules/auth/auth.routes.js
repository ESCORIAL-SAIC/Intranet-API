const express = require("express");
const jwt = require('jsonwebtoken');
const { pool } = require("../../config/db");
const requireAuth = require("../../middleware/requireAuth");

const router = express.Router();

/* VALIDACION PASSPORT */

router.post("/login",
    (req, res) => {
        pool.query("select id, username, password from web.v_intranet_usuarios where username = $1", [req.body.username], (err, results)=>{
            if(err){
                throw err;
            }

            if (results.rows.length > 0){
                const user = results.rows[0]

                if(req.body.password == user.password){
                    const payload = {
                        username: user.username,
                        id: user.id
                    }

                    const token = jwt.sign(payload, "Random string", { expiresIn: "365d" })

                    return res.status(200).send({
                        success: true,
                        message: "Logged in successfully!",
                        token: "Bearer " + token
                    })
                }else{
                    return res.status(401).send({
                        success: false,
                        message: "Contraseña Incorrecta"
                    })
                }
            }
            else{
                return res.status(401).send({
                    success: false,
                    message: "Usuario no encontrado"
                })
            }
        })
    }
)

router.get("/main", requireAuth, (req, res) => {
     return res.status(200).send({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
        }
    })
})

module.exports = router;
