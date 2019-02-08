/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 * Dependencies:
 *      - jsdom
 *      - jQuery
 *      - [jsrsasign](https://github.com/kjur/jsrsasign)
 */

const time = require("./TimeTracker");
const sql = require("./SQLQuery");
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
const ENCODED_KEY = Buffer.from(json.secret, "base64")
const jwt = KJUR.jws.JWS;
const TimeTracker = time.TimeTracker;

const trackers = {};  

sql.startConnections();
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

        if(jwt.verifyJWT(req.headers.AUTH_TITLE, ENCODED_KEY)){

            const requestPayload = jwt.parse(req.headers.AUTH_TITLE);
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
                    Client-ID: json.clientId
                },
                success: function(response){

                    const displayName = response["display_name"];
                    const tracker = new TimeTracker(displayName);
                    if(!trackers[channelId].hasOwnProperty(displayName)){

                        trackers[channelId] = [0, tracker];
                        sql.addViewer(channelId, response["id"], displayName);

                    }

                }

            });


            res.writeHead(200, headers);
            res.end(JSON.stringify(trackers));

        }

        // Handle if jwt is invalid.

    }

}).listen(json.port);


function populateTrackers(){
    const streamers = [];
    fetchStreamerList(streamers);
    const inter = setInterval(function{

        if(streamers != []){
            fetchTables(streamers, trackers);
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

