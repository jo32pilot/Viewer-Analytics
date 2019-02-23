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
let accessToken = "";
let refreshToken = "";

sql.startConnections();
sql.createStreamerList();
getBearerToken();
populateTrackers();
checkOnlineStreams();
schedule.scheduleJob(json.cronSettings, updateDays);
schedule.scheduleJob(json.cronSettings, refreshBearerToken);

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

        if(checkJWT(req, res)){ 
    
            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            $.ajax({

                url: json.apiURL + "users?id=" + requestPayload["user_id"],
                type: "GET",
                headers:{
                    "Authorization": `Bearer ${accessToken}`

                },
                success: function(response){
                    res.writeHead(200, headers);
                    res.end(response["display_name"]);
                },
            });
        }
    }
    else if(req.method == "GET" && req.url == json.initBoard){

        if(checkJWT(req, res)){ 

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
                    "Authorization": `Bearer ${accessToken}`
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
    else if(req.method == "GET" && req.url == json.getPeriod){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            if(req["period"] == "session"){
                res.writeHead(200, headers);
                res.end(JSON.stringify(trackers[requestPayload["channel_id"]));
            }
            else{
                sql.fetchPeriodTimes(requestPayload["channel_id"], 
                        req["period"], res);
            }

        }

    }
    else if(req.method == "GET" && req.url == json.toggleWhitelist){

        if(checkJWT(req, res)){

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

                res.writeHead(200, headers);
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


            if(trackers.hasProperty(req.headers["viewerQueriedFor"])){
                res.setHeader("whitelisted", false);
            }
            else{
                res.setHeader("whitelisted", true);
            }
            if(requestPayload["role"] == "broadcaster"){
                res.setHeader("broadcaster", true);
            }
            else{
                res.setHeader("broadcaster", false);
            }
            res.setHeader("viewerQueriedFor", req.headers["viewerQueriedFor"]);

            fetchLongTables(requestPayload["channel_id"], 
                    req.headers["viewerQueriedFor"], res);
        }
    }
    else if(req.method == "GET" && req.url == json.userSearch){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            const responsePayload = {};
            // This is super slow
            for(let viewer in regular[requestPayload["channel_id"]]){
                if(viewer.includes(requestPayload["viewerQueriedFor"])){
                    responsePayload[viewer] = time;
                }
            }
            res.writeHead(200, headers);
            res.end(JSON.stringify(responsePayload));
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
    }

    // Called when stream goes offline.
    else if(req.method == "GET" && req.url == json.stopTracker){
        
        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const channelId = requestPayload["channel_id"];
            const channelTrack = trackers[channelId];
            const whitelistTrack = whitelisted[channelId];

            sql.updateTime(trackers, whitelisted);
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

function checkOnlineStreams(){
    
    // TODO Error check in updateTime function for possible deletion
    // of tracker before update.
    sql.updateTime(trackers, whitelisted);

    // Gets results from "subtracting" the argument array
    // from the called array.
    Array.prototype.diff = function(array){
        return this.filter(function(item){
            return array.indexOf(item) < 0;
        });
    };

    const checkStream = setInterval(function(){
    
        $.ajax({
            type: "GET",
            url : `${json.extensionURL}${json.extensionId}/`
                    + `live_activated_channels`,
            headers: {
                "Client-Id": `${json.extensionId}`
            },
            success: function(res){

                const live = [];
                const allChannels = trackers.keys();
                for(let channel of res["channels"]){
                    live.push(channel["id"]);
                }

                const notLive = allChannels.diff(live);
                const channelTrack = trackers[channelId];
                const whitelistTrack = whitelisted[channelId];

                for(let channelId of notLive){

                    // TODO Maybe need to check if broadcaster first as well as
                    // for other requests.
                    for(let viewer in trackers[channelId]){
                        daily[channelId][viewer] += 
                                channelTrack[viewer].dailyTime;
                        channelTrack[viewer].stopTime();
                        channelTrack[viewer] = undefined;
                    }
                    for(let viewer in whitelisted[channelId]){
                        daily[channelId][viewer] += 
                                whitelistTrack[viewer].dailyTime;
                        whitelistTrack[viewer].stopTime();
                        whitelistTrack[viewer] = undefined;
                    }

                }

            }

        });

    }, json.checkOnlineInterval);
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

function getBearerToken(){

    $.ajax({
        type: "POST",
        url: `${json.tokenURL}client_id=${json.clientId}&`
                + `client_secret=${json.clientSecret}&`
                + `grant_type=client_credentials`,
        success: function(res){
            accessToken = res["access_token"],
            refreshToken = res["refresh_token"]
        },
        error: function(err){
            console.log(err);
        }
    });
}

function refreshBearerToken(){

    $.ajax({
        type: "POST",
        url: `${json.tokenRefreshURL}grant_type=refresh_token&`
                + `refresh_token=${refreshToken}&client_id=${json.clientId}&`
                + `client_secret=${json.clientSecret}`,
        success: function(res){
            accessToken = res["access_token"],
            refreshToken = res["refresh_token"]
        }
    });
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

