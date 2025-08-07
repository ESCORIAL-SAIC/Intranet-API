const fs = require("fs");
const path = require('path');
const pool = require("./db");

module.exports = function(app) {

app.get("/menu-button", async(req, res) => {
    try {
        const allDatas = await pool.query("select id, name, link, img_icon, button_color from web.intranet_menu");
        res.json(allDatas.rows)
    } catch (err) {
        console.log(err.message)
    }
})

app.get("/getdir", async(req, res) => {
    
    
    function getDirectoryContents(dirPath) {
        try{
            const items = fs.readdirSync(dirPath);
    
            const result = {
                name: path.basename(dirPath),
                path: dirPath,
                items: [],
            };
            
            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);
            
                if (stats.isDirectory()) {
                    const subdirectoryContents = getDirectoryContents(itemPath);
                    result.items.push(subdirectoryContents);
                } else {
                    result.items.push(item);
                }
            });
            
            return result;
        } catch (err) {
            console.log(err.message)
        }
      
    }
    
    const targetDirectory = req.query.dir; 
    const directoryContents = getDirectoryContents(targetDirectory);
    
    res.json(directoryContents)
})

app.get("/searchdir", async(req, res) => {
    
    
    function getDirectoryContents(dirPath, word) {
        try{
            const items = fs.readdirSync(dirPath);
    
            const result = {
                name: path.basename(dirPath),
                path: dirPath,
                items: [],
            };
            
            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);
            
                if (stats.isDirectory()) {
                    const subdirectoryContents = getDirectoryContents(itemPath);
                    result.items.push(subdirectoryContents);
                } else {
                    if(item.includes(word)){
                        result.items.push(item)
                    }
                }
            });
            
            return result;
        } catch (err) {
            console.log(err.message)
        }
      
    }
    
    const targetDirectory = req.query.dir; 
    const directoryContents = getDirectoryContents(targetDirectory);
    
    res.json(directoryContents)
})
}