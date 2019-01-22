/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 * Dependencies:
 *      - jsdom
 *      - jQuery
 *      - [jsrsasign](https://github.com/kjur/jsrsasign)
 */

const jwt = require("jsrsasign");
const https = require("https");
const fs = require("fs");

//Importing jQuery library. Credit for this work around goes to 
//https://github.com/rstacruz/mocha-jsdom/issues/27
const jsdom = require("jsdom");
const {JSDOM} = jsdom;
const {window} = new JSDOM();
const {document} = (new JSDOM('')).window;
global.document = document;
const $ = require("jquery")(window);

//All other constants go in config.json
const JSON_PATH = "./config.json";
const json = require(JSON_PATH);

const options = {

    cert: fs.readFileSync(json.certPath),
    key: fs.readFileSync(json.keyPath),

};

const server = https.createServer(options, function(req, res){

    const headers = json.headers;

    if(req.method == "OPTIONS"){

        res.writeHead(200, headers);
        res.end();

    }
    
    if(req.method == "GET" && req.url == json.initBoard){

        res.writeHead(200, headers);
        res.end(getData());

    }

}).listen(json.port);


/**
 * Retrieves data from database.
 */
function getData(){
    //temporary
    return "{\"data\":\"sample\", \"data2\":\"sample2\"}";
}
