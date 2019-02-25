/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 */

const schedule = require("node-schedule");
const jsrsasign = require("jsrsasign");
const time = require("./TimeTracker");
const qs = require("querystring");
const sql = require("./SQLQuery");
const log4js = require("log4js");
const crypto = require("crypto");
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

const trackers = {};        // Session TimeTrackers for non-whitelisted viewers
const whitelisted = {};     // Session TimeTrackers for whitelisted viewers
const daily = {};           // Tracks daily watch times for graphs
let accessToken = "";       // Bearer token for increase API call rates
let refreshToken = "";      // Token to refresh accessToken when needed

// Settup logging
log4js.configure({
    appenders: {
        everything: {
            type: "file", 
            filename: "server.log",
            maxLogSize: json.maxBytes, // Size of file in bytes before backup
            backups: json.maxBackups   // Number of backups created
        }
    },
    categories:{
        server: {
            appenders: ["everything"],
            level: "info"
        }
    }
});
const logger = log4js.getLogger();

sql.startConnections();
sql.createStreamerList();
getBearerToken();
sql.fetchStreamerList(sql.fetchTables, trackers, whitelisted);
sql.fetchStreamerList(multiStreamWebhook);
checkOnlineStreams();

// Cron schedule to update SQL days table for graph
schedule.scheduleJob(json.cronSettings, updateDays);

// Cron schedule to refresh bearerToken
schedule.scheduleJob(json.cronSettings, refreshBearerToken);
//TODO schedule cron for week, months, years? Or manually.

const options = {

    cert: fs.readFileSync(json.certPath),
    key: fs.readFileSync(json.keyPath),

};

// Begin init server
const server = https.createServer(options, function(req, res){

    const headers = json.headers;

    // CORS preflight request handler
    if(req.method == "OPTIONS"){

        res.writeHead(200, headers);
        res.end();

    }

    // Called when initializing board for the first time. Fetches session data
    // for viewer.
    if(req.method == "GET" && req.url == json.initBoard){

        if(checkJWT(req, res)){ 

            // Parse JWT payload
            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            const channelId = requestPayload["channel_id"];

            // If the channel isn't in trackers, create tables and places
            // to store the channel's data
            if(!trackers.hasOwnProperty(channelId)){
                trackers[channelId] = {};
                daily[channelId] = {};
                sql.updateStreamerList(channelId);
                sql.addStreamerTable(channelId);
                sql.createGraphTable(channelId);
            }
          
            // Twitch API call to GET user display name
            $.ajax({

                url: json.apiURL + "users?id=" + requestPayload["user_id"],
                type: "GET",
                headers:{
                    "Authorization": `Bearer ${accessToken}`
                },
                success: function(response){
    
                    // If the user is a streamer and their id (which is also
                    // their channel id) can't be found, that means
                    // we haven't subscribed to the webhook for their channel
                    // changes. So do that.
                    if(requestPayload["role"] == "broadcaster"){

                        if(!response["id"] in trackers){

                            singleStreamWebhook(response["id"]);

                        }

                        // Then we return because we don't want the streamer
                        // to accumulate time as well.
                        return;
                    }

                    const displayName = response["display_name"];
                    const tracker = new TimeTracker(displayName);

                    // If viewer can't be found in the channel's trackers, add
                    // them to it and the SQL tables.
                    if(!trackers[channelId].hasOwnProperty(displayName)){
                        sql.addViewer(channelId, response["id"], displayName);
                        sql.addViewerGraphTable(channelId, response["id"], 
                                displayName);
                        daily[channelId][displayName] = 0;

                    }

                    // Must go after if statement, otherwise viewer might never
                    // get a tracker
                    trackers[channelId][displayName] = tracker;
                    res.setHeader("name", displayName);
                },

                // Log request failures. Standard procedure for the rest of the
                // error handlers in thie file.
                error: function(jqXHR, textStatus, errThrown){
                    res.writeHead(json.badRequest);
                    res.end();
                    logger.info(textStatus);
                }
            });

            res.writeHead(200, headers);
            res.end(JSON.stringify(trackers[channelId]));

        }
    }

    // GET the time period of which the client wants to see. (e.g. week, year)
    else if(req.method == "GET" && req.url == json.getPeriod){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            // For current session, just send the trackers.
            if(req["period"] == "session"){
                res.writeHead(200, headers);
                res.end(JSON.stringify(trackers[requestPayload["channel_id"]));
            }

            // Otherwise, request other periods from MySQL server.
            else{
                sql.fetchPeriodTimes(requestPayload["channel_id"], 
                        req["period"], res);
            }

        }

    }

    // toggleWhitelist for viewer. That is, stop showing them on the
    // leaderboard. Bit of a misnomer. Probably should have called it 
    // blacklist instead as whitelisting entails granting some sort
    // of privilege, but I guess it can be seen as both. 
    else if(req.method == "GET" && req.url == json.toggleWhitelist){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            // Only allow this request if the streamer is making it.
            if(requestPayload.role == "broadcaster"){
                
                const response = undefined;

                // Swap tables for the viewer on the MySQL server.
                sql.swapViewer(requestPayload["channel_id"], 
                        req.headers["viewerQueriedFor"], 
                        req.headers["whitelisted"]);

                // If user wan't whitelisted before, whitelist them now
                if(trackers.hasProperty(req.headers["viewerQueriedFor"])){

                    whitelisted[req.headers["viewerQueriedFor"]] = 
                            trackers[req.headers["viewerQueriedFor"]];
                    delete trackers[req.headers["viewerQueriedFor"]];
                    response = "True";
                }

                // If user was whitelisted, unwhitelist them
                else{
                    
                    trakers[req.headers["viewerQueriedFor"]] = 
                            trackers[req.headers["viewerQueriedFor"]];
                    delete whitelisted[req.headers["viewerQueriedFor"]];
                    response = "False";

                }

                // "response" is sent for the client to change the whitelisted
                // staus text.
                res.writeHead(200, headers);
                res.end(response);
                
            }

            // Someone other than the broadcaster attempted to make this
            // request.
            else{
                res.writeHead(json.forbidden);
                res.end();
                logger.warn(`Illegal attempt - toggleWhitelist: `
                        + `${req["headers"]}`);
            }
        }

        // Either someone other than the broadcaster attempted to make this
        // request, or something went wrong.
        else{
            res.writeHead(json.forbidden);
            res.end();
            logger.warn(`Illegal attempt - toggleWhitelist: `
                    + `${req["headers"]}`);

        }
    }

    // GET all periods of time for the user specified.
    else if(req.method == "GET" && req.url == json.longStats){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            // Checks whether or not user was whitlisted.
            if(trackers.hasProperty(req.headers["viewerQueriedFor"])){
                res.setHeader("whitelisted", "False");
            }
            else{
                res.setHeader("whitelisted", "True");
            }

            // We check to see if the user was a broadcaster. If they are
            // tell the client so it can display a button for the streamer
            // to toggle whitelist for the viewer being queried for.
            if(requestPayload["role"] == "broadcaster"){
                res.setHeader("broadcaster", true);
            }
            else{
                res.setHeader("broadcaster", false);
            }

            // Send back who was being queried for. (Redundant? Maybe. But it
            // makes the client code look slightly cleaner for various reasons.)
            res.setHeader("viewerQueriedFor", req.headers["viewerQueriedFor"]);

            sql.fetchLongTables(requestPayload["channel_id"], 
                    req.headers["viewerQueriedFor"], res);
        }

        // Request was not made with a JWT signed by Twitch or something like
        // that. Probably.
        else{
            res.writeHead(json.forbidden);
            res.end();
            loggger.info(`Illegal attempt - fetchLongStats: `
                    + `${req["headers"]}`);
        }
    }

    // GET all users with usernames that contain the name queried for.
    else if(req.method == "GET" && req.url == json.userSearch){

        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            const responsePayload = {};

            // This is super slow. Like, m*n slow where m is the length
            // of the names and n is the amount of names. Don't know that
            // time complexity of includes though. There's probably a better
            // way the search for matching names.
            for(let viewer in regular[requestPayload["channel_id"]]){
                if(viewer.includes(requestPayload["viewerQueriedFor"])){
                    responsePayload[viewer] = time;
                }
            }
            res.writeHead(200, headers);
            res.end(JSON.stringify(responsePayload));
        }
        else{
            res.writeHead(json.forbidden);
            res.end();
            logger.info(`Illegal attempt - userSearch: req["headers"]`);
        }
    }

    // Pauses or unpauses time accumulation for specified viewer.
    else if(req.method == "GET" && req.url == json.toggleTracker){
        
        if(checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const viewer = requestPayload["viewerQueriedFor"];

            // Viewer unpaused the stream. Start accumulating time again.
            if(requestPayload["paused"] == false){

                if(trackers.hasProperty(viewer)){
                    trackers[viewer].unpauseTime();
                }
                else{
                    whitelisted[viewer].unpauseTime();
                }

            }

            // User paused the stream. Stop accumulating time.
            else{
               
                if(trackers.hasProperty(viewer)){
                    trackers[viewer].pauseTime();
                }
                else{
                    whitelisted[viewer].pauseTime();
                }

            }
        }
        else{
            res.writeHead(json.forbidden);
            res.end();
            logger.info(`Illegal attempt - toggleTracker: req["headers"]`);
        }
    }

    // To verify the webhook subscription
    else if(req.method == "GET" && req.url == json.stopTracker){

        const token = queryParamreq.url.split(json.verificationDelimiter);

        // Token will always be at the end of the query string.
        token = token[token.length];
        res.writeHead(json.success, token);
        res.end();

    }

    // Called when stream goes offline. Request comes from Twitch webhook 
    // subscription. Or it should, at least.
    else if(req.method == "POST" && req.url == json.stopTracker){

        // Twitch specified to respond with a success immediatley when 
        // request is retrieved.
        res.writeHead(json.success);
        res.end();

        // Verify that request is from twitch webhook subscription
        const incoming = req.headers["x-hub-signature"].
                split(json.verificationDelimiter);

        const hash = crypto.createHmac(incoming[0], json.clintSecret).
                update(JSON.stringify(req.body)).
                digest("hex");

        if(incoming[1] == hash){

            // Parse POST data
            let body = "";
            request.on("data", function(data){
                body += data;

                // Either something went wrong or someone is attempting
                // to overflow the server.
                if(body.length > 1e6){
                    logger.fatal(`Overflow attempt - stopTracker: `
                            + `ORIGIN: ${req["Origin"]}`);
                    request.connection.destroy();
                }
            }

            // Once all data has been collected.
            request.on("end", function(){

                // Parse query string into object format.
                const data = qs.parse(body);

                // user_id is apparently the same as channel_id. Wish I'd known
                // that earlier.
                const channelId = data["user_id"];
                const channelTrack = trackers[channelId];
                const whitelistTrack = whitelisted[channelId];

                // update all appropriate times from trackers and whitelisted
                // in the broadcaster's SQL tables.
                sql.updateTime(trackers, whitelisted);

                // Update daily times which will be added to the MySQL server
                // at the end of the day. Then remove references to trackers.
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

            });
        }

        // Request probably wasn't from Twitch.
        else{
            logger.warn(`Illegal attempt - stopTracker: req["headers"]`);
        }
    }

}).listen(json.port);

/* End of server definition */

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

/**
 * Subscribes to broadcast changes for the specified broadcaster. If
 * the broadcaster goes offline, handles deletion of trackers.
 * @param {String} broadcasterId Unique of of broadcaster to monitor.
 */
function singleStreamWebhook(broadcasterId){

    $.ajax({
        type: "POST",
        url: json.webhookURL,
        data: {
            hub.callback: json.webServerURL + json.stopTracker,
            hub.mode: "subscribe",
            hub.topic: json.streamTopicURL + broadcasterId,
            //TODO after testing define webhook expiration
            hub.secret: json.secret
        }
        error: function(jsXHR, textStatus, err){
            logger.error(`Failed attempt - webhookSubscribe %s: `
                    + `${textStatus}`);
        }
    });
}

/**
 * Subscribes to broadcast changes for all specified broadcasters. If
 * the broadcaster goes offline, handles deletion of trackers.
 * @param {Array} broadcasterId Array of broadcasters ids.
 */
function multiStreamWebhook(broadcasterIds){

    for(let streamer of broadcasterIds){

        singleStreamWebhook(streamer);
        streamerIds.push(streamer);

    }

}

function getBearerToken(){

    $.ajax({
        type: "POST",
        url: json.tokenURL,
        data: {
            "client_id": json.clientId,
            "client_secret": json.clientSecret,
            "grant_type" = "client_credentials"
        },
        success: function(res){
            accessToken = res["access_token"],
            refreshToken = res["refresh_token"]
        },
        error: function(jsXJR, textStatus, err){
            logger.error(`Failed attempt - getBearerToken: ${textStatus}`);
        }
    });
}

function refreshBearerToken(){

    $.ajax({
        type: "POST",
        url: `${json.tokenRefreshURL},
        data: {
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": json.clientId,
            "client_secret": json.clientSecret
        },
        success: function(res){
            accessToken = res["access_token"],
            refreshToken = res["refresh_token"]
        }
        error: function(jsXHR, textStatus, err){
            logger.error(`Failed attempt - refreshBearerToken: ${textStatus}`);
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
    
    logger.shutdown(function(){});

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

