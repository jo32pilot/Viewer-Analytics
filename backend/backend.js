/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 * Dependencies:
 *      - jsdom
 *      - jQuery
 *      - [jsrsasign](https://github.com/kjur/jsrsasign)
 */

const jsrsasign = require("jsrsasign");
const time = require("./TimeTracker");
const sql = require("./SQLQuery");
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
const jwt = jsrsasign.KJUR.jws.JWS;
const TimeTracker = time.TimeTracker;

const trackers = {};
const whitelisted = {};

sql.startConnections();
sql.createStreamerList();
populateTrackers();

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

        if(jwt.verifyJWT(req.headers["extension-jwt"], 
                {"b64": json.secret}, {alg: [json.alg]})){

            console.log("Processing request...");

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const channelId = requestPayload["channel_id"];
            if(!trackers.hasOwnProperty(channelId)){
                trackers[channelId] = {};
                sql.updateStreamerList(channelId);
                sql.addStreamerTable(channelId);
            }
            
            $.ajax({

                url: json.apiURL + "users?id=" + requestPayload["user_id"],
                type: "GET",
                headers:{
                    "Client-ID": json.clientId
                },
                success: function(response){

                    if(requestPayload["role"] == "broadcaster"){
                        return;
                    }

                    const displayName = response["display_name"];
                    const tracker = new TimeTracker(displayName);

                    if(!trackers[channelId].hasOwnProperty(displayName)){
                        sql.addViewer(channelId, response["id"], displayName);
                    }

                    // Must go after if statement, otherwise viewer might never
                    // get added.
                    trackers[channelId][displayName] = tracker;
                },

                // TODO redefine
                error: function(){
                    console.log("User probably doesn't exist.");
                }
            });

            res.writeHead(200, headers);
            res.end(JSON.stringify(trackers[channelId]));

        }
        else{
            console.log("FORBIDDEN");
            res.writeHead(400);
            res.end();
        }

        // Handle if jwt is invalid.

    }
    else if(req.method == "GET" && req.url == json.toggleWhitelist){

        if(jwt.verifyJWT(req.headers["extension-jwt"], 
                {"b64": json.secret}, {alg: [json.alg]})){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            if(requestPayload.role == "broadcaster"){
                
                

            }
            else{
                res.writeHead(400);
                res.end();
            }
        }
    }
    else if(req.method == "GET" && req.url == json.longStats){

        if(jwt.verifyJWT(req.headers["extension-jwt"], 
                {"b64": json.secret}, {alg: [json.alg]})){
        

    }
    else if(req.method == "GET" && req.url == json.userSearch){

    }

}).listen(json.port);

function populateTrackers(){
    const streamers = [];
    sql.fetchStreamerList(streamers);
    const inter = setInterval(function(){

        if(streamers != []){
            sql.fetchTables(streamers, trackers, whitelisted);
            clearInterval(inter);
        }

    }, 1000);
}

function killGracefully(){

    sql.endConnections();

    server.close(function(){
        process.exit(0);
    });
}

process.on("SIGTERM", function(){
    killGracefully();
});

process.on("SIGINT", function(){
    killGracefully();
});
