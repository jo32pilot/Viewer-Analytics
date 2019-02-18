/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 */

const schedule = require("node-schedule");
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
const daily = {};
let shuttingDown = false;

sql.startConnections();
sql.createStreamerList();
populateTrackers();
updatePeriodically();
schedule.scheduleJob(json.cronSettings, updateDays);

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

    if(req.method == "GET" && req.url == json.getName){

        if(checkJWT(req, res){ 
    
            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            $.ajax({

                url: json.apiURL + "users?id=" + requestPayload["user_id"],
                type: "GET",
                headers:{
                    "Client-ID": json.clientId
                },
                success: function(response){
                    res.writeHead(200, headers);
                    res.end(response["display_name"]);
                },
            });
        }
    }
    else if(req.method == "GET" && req.url == json.initBoard){

        if(checkJWT(req, res){ 

            console.log("Processing request...");

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const channelId = requestPayload["channel_id"];
            if(!trackers.hasOwnProperty(channelId)){
                trackers[channelId] = {};
                daily[channelId] = {};
                sql.updateStreamerList(channelId);
                sql.addStreamerTable(channelId);
                sql.createGraphTable(channelId);
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
                        sql.addViewerGraphTable(channelId, response["id"], 
                                displayName);
                        daily[channelId][displayName] = 0;

                    }

                    // Must go after if statement, otherwise viewer might never
                    // get a tracker
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
    }
    else if(req.method == "GET" && req.url == json.toggleWhitelist){

        if(checkJWT(req, res){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            if(requestPayload.role == "broadcaster"){
                
                sql.swapViewer(requestPayload["channel_id"], 
                        req.headers["viewerQueriedFor"], 
                        req.headers["whitelisted"]);

                if(trackers.hasProperty(req.headers["viewerQueriedFor"])){

                    whitelisted[req.headers["viewerQueriedFor"]] = 
                            trackers[req.headers["viewerQueriedFor"]];
                    delete trackers[req.headers["viewerQueriedFor"]];
                }
                else{
                    
                    trakers[req.headers["viewerQueriedFor"]] = 
                            trackers[req.headers["viewerQueriedFor"]];
                    delete whitelisted[req.headers["viewerQueriedFor"]];

                }

                res.writeHead(200);
                res.end();
                
            }
            else{
                res.writeHead(400);
                res.end();
            }
        }
    }
    else if(req.method == "GET" && req.url == json.longStats){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            fetchLongTables(requestPayload["channel_id"], 
                    requestPayload[""], res);
        }
    }
    else if(req.method == "GET" && req.url == json.userSearch){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            const responsePayload = {};
            // This is super slow
            for(let viewer in regular[requestPayload["channel_id"]]){
                if(viewer.includes(requestPayload["viewerQueriedFor"]){
                    responsePayload[viewer] = time;
                }
            }
            res.writeHead(200, headers);
            res.end(responsePayload);
        }
    }
    else if(req.method == "GET" && req.url == json.toggleTracker){
        
        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const viewer = requestPayload["viewerQueriedFor"];

            if(requestPayload["paused"] == false){

                if(trackers.hasProperty(viewer)){
                    trackers[viewer].unpauseTime();
                }
                else{
                    whitelisted[viewer].unpauseTime();
                }

            }
            else{
               
                if(trackers.hasProperty(viewer)){
                    trackers[viewer].pauseTime();
                }
                else{
                    whitelisted[viewer].pauseTime();

            }
        }
    }

    // Called when stream goes offline.
    else if(req.method == "GET" && req.url == json.stopTracker){
        
        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const channelId = requestPayload["channel_id"];
            const channelTrack = trackers[channelId];
            const whitelistTrack = whitelisted[channelId];

            // TODO Maybe need to check if broadcaster first as well as 
            // for other requests.
            for(let viewer in trackers[channelId]){
                daily[channelId][viewer] += channelTrack[viewer].dailyTime;
                channelTrack[viewer].stopTime();
                channelTrack[viewer] = undefined;
            }
            for(let viewer in whitelisted[channelId]){
                daily[channelId][viewer] += whitelistTrack[viewer].dailyTime;
                whitelistTrack[viewer].stopTime();
                whitelistTrack[viewer] = undefined;
            }
        }
    }

}).listen(json.port);

function updatePeriodically(){

    const inter = setInterval(function(){

        if(!shuttingDown){
            sql.updateTime(trackers, whitelisted);
        }
        else{
            clearInterval(inter);
        }

    }, updateTime);
}

function updateDays(){

    for(let channel in days){

        sql.updateGraphTable(channel, days[channel]);

        for(let viewer in trackers[channel]){

            if(trackers[channel][viewer] != undefined){
                trackers[channel][viewer].dailyTime = 0;
            }

        }
        for(let viewer in whitelisted[channel]){

            if(whitelisted[channel][viewer] != undefined){
                whitelisted[channel][viewer].dailyTime = 0;
            }

        }
    }
}

function populateTrackers(){
    const streamers = [];
    sql.fetchStreamerList(streamers);
    const inter = setInterval(function(){

        if(streamers != []){
            sql.fetchTables(streamers, trackers, whitelisted);
            clearInterval(inter);
        }

    }, json.oneSecond);
}

function checkJWT(req, res){

    if(!jwt.verifyJWT(req.headers["extension-jwt"],
            {"b64": json.secret}, {alg: [json.alg]})){
            
        res.writeHead(400);
        res.end();
        return false;
    }
    return true;
}

function killGracefully(){
    
    shuttingDown = true;
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

