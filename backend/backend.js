/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 * 
 * NOTE: I realized a little too late that I've been writing "day" table in 
 * comments which is probably pretty ambiguous. I mean the table that stores the
 * times accumulated each day. I.e., the table with the "graph suffix" attached
 * to it. (@see SQLQueries.js)
 */

const schedule = require("node-schedule");
const jsrsasign = require("jsrsasign");
const time = require("./TimeTracker");
const flatted = require("flatted");
const qs = require("querystring");
const sql = require("./SQLQuery");
const log4js = require("log4js");
const crypto = require("crypto");
const https = require("https");
const util = require("util");
const fs = require("fs");

//All other constants go in config.json
const JSON_PATH = "./config.json";
const json = require(JSON_PATH);
const jwt = jsrsasign.KJUR.jws.JWS;
const TimeTracker = time.TimeTracker;


// Session TimeTrackers for non-whitelisted viewers.
const /** !Object<string, <string, !TimeTracker>> */ trackers = {};

// Session TimeTrackers for whitelisted viewers.
const /** !Object<string, <string, !TimeTracker>> */ whitelisted = {};

// Tracks daily watch times for graphs.
const /** !Object<string, <string, !TimeTracker>> */ daily = {};

// Tracks if stream is offline or not. True if online, false otherwise.
const /** !Object<string, boolean> */ isOnline = {};

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
        default: {
            appenders: ["everything"],
            level: "info"
        }
    }
});
const logger = log4js.getLogger("Server");


if(sql.startConnections()){
    log4js.shutdown(function(){});
    process.exit(0);
}

_assertInitSQLErr(sql.createStreamerList());
getBearerToken();
_assertInitSQLErr(sql.fetchStreamerList(sql.fetchTables, trackers, 
        whitelisted));
_assertInitSQLErr(sql.fetchStreamerList(multiStreamWebhook));

// Cron schedule to update SQL days table for graph
schedule.scheduleJob(json.cronSettings, updateDays);

// Cron schedule to refresh bearerToken
schedule.scheduleJob(json.cronSettings, refreshBearerToken);

// Cron schedule to clear weekly times.
schedule.scheduleJob(json.cronWeekly, sql.clearWeek);

// Cron schedule to clear daily times.
schedule.scheduleJob(json.cronMonthly, sql.clearMonth);

// YEARLY TIMES WILL BE DONE MANUALLY. If I remember...

const options = {

    cert: fs.readFileSync(json.certPath),
    key: fs.readFileSync(json.keyPath),

};


/* Begin server definition */

const server = https.createServer(options, function(req, res){

    const headers = json.headers;

    // Parsing URL for webhook subscription.
    let webhookPath = undefined;
    const urlSplit = req.url.split(json.pathDelimiter);
    if(urlSplit.length >= json.minURLLength){
        webhookPath = json.pathDelimiter + 
                urlSplit[urlSplit.length - json.minURLLength];
    }

    // CORS preflight request handler
    if(req.method == "OPTIONS"){

        res.writeHead(json.success, headers);
        res.end();

    }

    // Called when initializing board for the first time. Fetches session data
    // for viewer.
    if(req.method == "GET" && req.url == json.initBoard){

        if(_checkJWT(req, res)){ 

            // Parse JWT payload
            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            const userId = requestPayload["user_id"]
            const channelId = requestPayload["channel_id"];

            // If the channel isn't in trackers, create tables and places
            // to store the channel's data
            if(!trackers.hasOwnProperty(channelId)){
                trackers[channelId] = {};
                sql.updateStreamerList(channelId);
                sql.addStreamerTable(channelId);
                sql.createGraphTable(channelId);
            }
            if(!daily.hasOwnProperty(channelId)){
                daily[channelId] = {};
            }
         
            // Begin Twitch API call to GET user display name
            const reqOptions = {
                "host": json.apiURL,
                "path": json.apiPath + requestPayload["user_id"],
                "method": "GET",
                "headers": _attachAuth(),
            };

            const request = https.request(reqOptions, function(requestResponse){
   
                requestResponse.setEncoding("utf8");
                let data = "";
                requestResponse.on("data", function(chunk){
                    data += chunk;

                    // Either something went wrong or someone is attempting
                    // to overflow the server.
                    if(data.length > 1e6){
                        logger.fatal(`Overflow attempt - initBoard: `
                                + `ORIGIN: ${req["Origin"]}`);
                        request.connection.destroy();
                    }
                });
                requestResponse.on("end", function(){
                    
                    const response = JSON.parse(data)["data"][0];

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
                    if(isOnline[channelId]){

                        // If viewer started watching the stream for the first
                        // time this session, init a TimeTracker
                        if(trackers[channelId][displayName] == undefined){
                            const tracker = new TimeTracker(displayName);
                            trackers[channelId][displayName] = tracker;
                        }

                        // Otherwise, the probably refreshed or came back after
                        // leaving the site. So unpause their timer.
                        else{
                            trackers[channelId][displayName].unpauseTime();
                        }

                        res.setHeader("name", displayName);
                    }

                    res.writeHead(json.success, headers);

                    // TimeTracker is a circular object. Must call util.inspect.
                    res.end(flatted.stringify(trackers[channelId]));

                });

            });


            // Log request failures. Standard procedure for the rest of the
            // error handlers in thie file.
            request.on("error", function(errThrown){
                res.writeHead(json.badRequest, headers);
                res.end();
                logger.info(`initBoard: API call - ${errThrown.message}`);
            });

            request.end();


        }
    }

    // GET the time period of which the client wants to see. (e.g. week, year)
    else if(req.method == "GET" && req.url == json.getPeriod){

        if(_checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            // For current session, just send the trackers.
            if(req["period"] == "session"){
                res.writeHead(json.success, headers);
                res.end(flatted.stringify(
                        trackers[requestPayload["channel_id"]]));
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

        if(_checkJWT(req, res)){

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
                if(trackers.hasOwnProperty(req.headers["viewerQueriedFor"])){

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
                res.writeHead(json.success, headers);
                res.end(response);
                
            }

            // Someone other than the broadcaster attempted to make this
            // request.
            else{
                res.writeHead(json.forbidden);
                res.end();
                logger.warn(`Illegal attempt: Not Broadcaster - `
                        + `toggleWhitelist: ${req["headers"]}`);
            }
        }

        // Either someone other than the broadcaster attempted to make this
        // request, or something went wrong.
        else{
            res.writeHead(json.forbidden);
            res.end();
            logger.warn(`Illegal attempt JWT Invalid - toggleWhitelist: `
                    + `${req["headers"]}`);

        }
    }

    // GET all periods of time for the user specified.
    else if(req.method == "GET" && req.url == json.longStats){

        if(_checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;

            // Checks whether or not user was whitlisted.
            if(trackers.hasOwnProperty(req.headers["viewerQueriedFor"])){
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

        if(_checkJWT(req, res)){

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
            res.writeHead(json.success, headers);
            res.end(flatted.stringify(responsePayload));
        }
        else{
            res.writeHead(json.forbidden);
            res.end();
            logger.info(`Illegal attempt: JWT Invalid - userSearch: `
                    + `${req["headers"]}`);
        }
    }

    // Pauses or unpauses time accumulation for specified viewer.
    else if(req.method == "GET" && req.url == json.toggleTracker){
        
        if(_checkJWT(req, res)){

            const requestPayload = jwt.parse(req.headers["extension-jwt"]).
                    payloadObj;
            const viewer = requestPayload["viewerQueriedFor"];

            // Viewer unpaused the stream. Start accumulating time again.
            if(requestPayload["paused"] == false){

                if(trackers.hasOwnProperty(viewer)){
                    trackers[viewer].unpauseTime();
                }
                else{
                    whitelisted[viewer].unpauseTime();
                }

            }

            // User paused the stream. Stop accumulating time.
            else{
               
                if(trackers.hasOwnProperty(viewer)){
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
            logger.info(`Illegal attempt: JWT Invalid - toggleTracker: `
                    + `${req["headers"]}`);
        }
    }

    // To verify the webhook subscription
    else if(req.method == "GET" && webhookPath == json.stopTracker){

        const queryParam = req.url.split(json.queryDelimiter);
        let token = qs.parse(queryParam[1]);
        
        if(token["hub.challenge"] == undefined){
            logger.info(`Subscription mode: ${token["hub.mode"]}`
                    + `Reason: ${token["hub.reason"]}`);
            res.writeHead(json.success);
            res.end();
        }

        else{
            logger.info(`Subscription success: ${queryParam[0]}`);

            // Token will always be at the end of the query string.
            token = token["hub.challenge"];
            res.write(token);
            res.end();
        }

    }

    // Called when stream goes offline. Request comes from Twitch webhook 
    // subscription. Or it should, at least. There really ever is only
    // one post request and that's from Twitch so we'll leave this as is.
    else if(req.method == "POST"){


        // Twitch specified to respond with a success immediatley when 
        // request is retrieved.
        res.writeHead(json.success);
        res.end();

        // Parse POST data
        let body = "";
        req.on("data", function(data){
            body += data;

            // Either something went wrong or someone is attempting
            // to overflow the server.
            if(body.length > 1e6){
                logger.fatal(`Overflow attempt - stopTracker: `
                        + `ORIGIN: ${req["Origin"]}`);
                request.connection.destroy();
            }
        });


        // Once all data has been collected.
        req.on("end", function(){

            // Verify that request is from twitch webhook subscription
            const incoming = req.headers["x-hub-signature"].
                    split(json.verificationDelimiter);

            const hash = crypto.createHmac(incoming[0], json.personalSecret).
                    update(body).digest("hex");

            if(incoming[1] == hash){

                // Parse query string into object format.
                let data = JSON.parse(body)["data"][0];

                // An empty array means the streamer offline. So if we don't
                // have an empty array, then there's nothing to do.
                if(data != []){
                    isOnline[urlSplit[json.pathChannelIdIndex]] = true;
                    return;
                }

                isOnline[urlSplit[json.pathChannelIdIndex]] = false;

                // user_id is apparently the same as channel_id. Wish I'd known
                // that earlier.
                const channelId = urlSplit[json.pathChannelIdIndex];
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
                daily[channelId][viewer] += whitelistTrack[viewer].
                        dailyTime;
                whitelistTrack[viewer].stopTime();
                whitelistTrack[viewer] = undefined;
                }

                logger.info(`Channel ${channelId} went offline.`);

            }

            // Request probably wasn't from Twitch.
            else{
                logger.warn(`Illegal attempt - stopTracker: req["headers"]`);
            }

        });

    }

}).listen(json.port);

/* End of server definition */




/**
 * Function called as cron job. Updates "day" sql tables at the end of each 
 * day.
 */
function updateDays(){

    for(let channel in days){

        // Pass in each channel to SQL function to update.
        sql.updateGraphTable(channel, days[channel]);

        for(let viewer in trackers[channel]){

            // If the viewer has a TimeTracker attached to them, reset that
            // tracker's daily time to 0.
            if(trackers[channel][viewer] != undefined){
                trackers[channel][viewer].dailyTime = 0;
            }

        }

        // Same thing for those whitelisted.
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
    
    const topic = encodeURIComponent(json.streamTopicURL + broadcasterId);
    const callback = encodeURIComponent(`${json.webServerURL}:${json.port}`
            + `${json.stopTracker}/${broadcasterId}`);

    const webhookPath = `${json.webhookPath}`
            + `?hub.callback=${callback}`
            + `&hub.mode=subscribe`
            + `&hub.topic=${topic}`
            + `&hub.lease_seconds=${json.subscriptionExpiration}`
            + `&hub.secret=${json.personalSecret}`;

    // Request specification is documented on Twitch's developers pages.
    // @see New Twitch API - webhooks
    const reqOptions = {
        "host": json.apiURL,
        "path": webhookPath,
        "method": "POST",
        "headers": {
            "Client-ID": json.clientId,
        },
    }

    const req = https.request(reqOptions, function(res){

        logger.info(`Webhook request for ${broadcasterId} ended.\n`
                + `\tStatus code: ${res.statusCode}\n`
                + `\tMessage: ${res.statusMessage}`);

    });

    req.on("error", function(err){
        logger.error(`Failed attempt - webhookSubscribe ${broadcasterId}: `
                + `${err.message}`);
    });
    req.end();
}


/**
 * Subscribes to broadcast changes for all specified broadcasters. If
 * the broadcaster goes offline, handles deletion of trackers.
 * Used on server start up.
 * @param {Array} broadcasterId Array of broadcasters ids.
 */
function multiStreamWebhook(broadcasterIds){

    for(let streamer of broadcasterIds){

        singleStreamWebhook(streamer);

    }

}

/**
 * Retrieves a bearer token from Twitch for authentication. This allows for
 * more API calls.
 */
function getBearerToken(){

    // Again, specification is Documented by Twitch.
    // @see Twitch Developers - authentication
    const tokenPath = `${json.tokenPath}`
            + `?client_id=${json.clientId}`
            + `&client_secret=${json.clientSecret}`
            + `&grant_type=client_credentials`;

    const reqOptions = {
        "host": json.tokenURL,
        "path": tokenPath,
        "method": "POST"
    };

    const req = https.request(reqOptions, function(res){

        let data = "";
        res.on("data", function(chunk){
            data += chunk;

            // Either something went wrong or someone is attempting
            // to overflow the server.
            if(data.length > 1e6){
                logger.fatal(`Overflow attempt - getBearerToken: `
                        + `ORIGIN: ${req["Origin"]}`);
                request.connection.destroy();
            }
        });

        // Sets accessToken and refreshToken for use later.
        res.on("end", function(){
            logger.info(`Access token recieved`);
            data = JSON.parse(data);
            if(data["status"] == json.forbidden){
                logger.error(`Invalid attempt - getBearerToken: `
                        + `${data["status"]}: ${data["message"]}`);
            }
            accessToken = data["access_token"],
            refreshToken = data["refresh_token"]
        });

    });

    req.on("error", function(err){
        logger.error(`Failed attempt - getBearerToken: ${err}`);
    });

    req.end();
}

/**
 * Refreshes bearer token as it expires after some time. Refreshes everyday.
 */
function refreshBearerToken(){

    const refreshPath = `${json.tokenRefreshPath}`
            + `?grant_type=refresh_token`
            + `&refresh_token=${refreshToken}`
            + `&client_id=${json.clientId}`
            + `&client_secret=${json.clientSecret}`;

    const reqOptions = {
        "host": json.tokenURL,
        "path": refreshPath,
        "method": "POST",
    };

    const req = https.request(reqOptions, function(res){

        let data = "";
        res.on("data", function(chunk){
            data += chunk;

            // Either something went wrong or someone is attempting
            // to overflow the server.
            if(data.length > 1e6){
                logger.fatal(`Overflow attempt - refreshBearerToken: `
                        + `ORIGIN: ${req["Origin"]}`);
                request.connection.destroy();
            }
        });

        // Sets accessToken and refreshToken for use later.
        res.on("end", function(){
            logger.info(`Access token refreshed`);
            data = JSON.parse(data);
            accessToken = data["access_token"],
            refreshToken = res["refresh_token"]
         });

    });

    req.on("error", function(err){
        logger.error(`Failed attempt - refreshBearerToken: ${err.message}`);
    });

    req.end();

}

/**
 * Helper function to check if the JWT from the client is valid.
 * @param {IncomingMessage} req Request from client that contains the JWT.
 * @param {ServerResponse} res Response to client. Used to writeHead and end if
 *                         JWT isn't valid.
 * @return false if JWT is not valid. True otherwise.
 */
function _checkJWT(req, res){

    if(!jwt.verifyJWT(req.headers["extension-jwt"],
            {"b64": json.secret}, {alg: [json.alg]})){
            
        res.writeHead(json.forbidden);
        res.end();
        return false;
    }
    return true;
}

/**
 * Attaches authorization token to headers if the token exists. Otherwise,
 * in order to not rely on the existence of an auth token, we create
 * an empty headers object.
 * @return {Object} headers for to make requests. Contains auth token if the
 *                  token exists. Empty otherwise.
 */
function _attachAuth(){
    let headers = {};
    if(accessToken != "" && accessToken != undefined){
        headers["Authorization"] = `Bearer ${accessToken}`
    }
    return headers;
}

/**
 * Checks if sql set up functions near top of file had an error occurr.
 * Handles accordingly.
 * @param {boolean} isErr True if error occurred, false otherwise.
 */
function _assertInitSQLErr(isErr){
    if(isErr){
        log4js.shutdown(function(){});
        sql.endConnections();
        process.exit(0);
    }
}

/**
 * Helper function to kill server gracefully in the event of
 * the program shutting down.
 */
function _killGracefully(){
    
    sql.endConnections();

    server.close(function(){
        log4js.shutdown(function(){});
        process.exit(0);
    });
}

// Unix exit code listeners.

process.on("SIGTERM", function(){
    _killGracefully();
});

process.on("SIGINT", function(){
    _killGracefully();
});
