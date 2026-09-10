const express = require("express");
const fs = require("fs");
const path = require('path');

const router = express.Router();

/* EXPLORADOR DE ARCHIVOS */

router.get("/getdir", async(req, res) => {


    function getDirectoryContents(dirPath) {
        try{
            const items = fs.readdirSync(dirPath);

            const result = {
                name: path.basename(dirPath),
                path: dirPath,
                type: 'folder',
                items: [],
            };

            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    const subdirectoryContents = getDirectoryContents(itemPath);
                    result.items.push(subdirectoryContents);
                } else {
                    result.items.push(
                        {
                            name: item,
                            path: itemPath,
                            type: 'file',
                        }
                    );
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

router.get("/searchdir", async(req, res) => {

    const result = {
        name: path.basename(req.query.dir),
        type: 'folder',
        items: [],
    }

    function getDirectoryContents(dirPath, word) {

        try{
            const items = fs.readdirSync(dirPath);

            items.forEach(item => {
                const itemPath = path.join(dirPath, item);
                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    const subdirectoryContents = getDirectoryContents(itemPath, word);
                } else {
                    if(item.includes(word)){
                        result.items.push(
                            {
                                name: item,
                                path: itemPath,
                                type: 'file',
                            }
                        );
                    }
                }
            });

            return result;
        } catch (err) {
            console.log(err.message);
        }

    }

    const targetDirectory = req.query.dir;
    const search = req.query.search;
    const directoryContents = getDirectoryContents(targetDirectory, search);
    res.json(directoryContents)
})

module.exports = router;
