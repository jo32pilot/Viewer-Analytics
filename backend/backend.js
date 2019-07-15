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
const _MS_PER_DAY = 1000 * 60 * 60 * 24;


// Session TimeTrackers for non-whitelisted viewers.
const /** !Object<string, <string, !TimeTracker>> */ trackers = {};

// Session TimeTrackers for whitelisted viewers.
const /** !Object<string, <string, !TimeTracker>> */ whitelisted = {};

// Tracks daily watch times for graphs.
const /** !Object<string, <string, int>> */ daily = {};

// Tracks if stream is offline or not. Value is the start time if the stream is
// online. Otherwise undefined.
const /** !Object<string, string> */ isOnline = {};

let accessToken = "";       // Bearer token for increase API call rates


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

// Cron schedule to update SQL days table for graph
schedule.scheduleJob(json.cronSettings, updateDays);

// Cron schedule to refresh bearerToken
schedule.scheduleJob(json.cronSettings, getBearerToken);

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
                whitelisted[channelId] = {};
                singleStreamWebhook(channelId);
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

                    let response = JSON.parse(data)["data"];

                    // If the user is a streamer and their id (which is also
                    // their channel id) can't be found, that means
                    // we haven't subscribed to the webhook for their channel
                    // changes. So do that.
                    if(requestPayload["role"] == "broadcaster"){

                        if(response != undefined){
                            response = response[0];
                            const displayName = response["display_name"];
                            res.setHeader("name", displayName);
                        }

                        // Then we end and return because we don't want the 
                        // streamer to accumulate time as well.
                        res.writeHead(json.success, headers);
                        res.end(JSON.stringify(_parseTimes(channelId)));
                        return;
                    }

                    // ID sharing not on.
                    if(response == undefined){
                        res.writeHead(json.success, headers);
                        res.end(JSON.stringify(_parseTimes(channelId)));
                        return;
                    }

                    response = response[0];
                    const displayName = response["display_name"];

                    // If viewer can't be found in the channel's trackers, add
                    // them to it and the SQL tables.
                    if(!trackers[channelId].hasOwnProperty(displayName) && 
                            !whitelisted[channelId].hasOwnProperty(displayName)){
                        sql.addViewer(channelId, response["id"], displayName);
                        sql.addViewerGraphTable(channelId, response["id"], 
                                displayName);
                        daily[channelId][displayName] = 0;
                        trackers[channelId][displayName] = undefined;

                    }
                    
                    // Must go after if statement, otherwise viewer might never
                    // get a tracker
                    if(isOnline[channelId] != undefined){

                        // If viewer started watching the stream for the first
                        // time this session, init a TimeTracker.
                        // Otherwise, the probably refreshed or came back after
                        // leaving the site. So unpause their timer.
                        if(trackers[channelId].hasOwnProperty(displayName)){ 

                            if(trackers[channelId][displayName] == undefined){

                                const tracker = new TimeTracker(response["id"]);
                                trackers[channelId][displayName] = tracker;

                            }
                            if(req.headers["paused"] == "true"){
                                trackers[channelId][displayName].pauseTime();
                            }
                            else{
                                trackers[channelId][displayName].prevNow = Date.now();
                                trackers[channelId][displayName].unpauseTime();
                            }
                        }
                        else if(whitelisted[channelId][displayName] == 
                                undefined){

                            const tracker = new TimeTracker(response["id"]);
                            whitelisted[channelId][displayName] = tracker;

                            if(req.headers["paused"] == "true"){
                                whitelisted[channelId][displayName].pauseTime();
                            }
                        }
                        else if(req.headers["paused"] != "true"){
                            whitelisted[channelId][displayName].prevNow = Date.now();
                            whitelisted[channelId][displayName].unpauseTime();
                        }

                    }

                    res.setHeader("name", displayName);
                    res.writeHead(json.success, headers);
                    res.end(JSON.stringify(_parseTimes(channelId)));

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
            if(req.headers["period"] == "session"){
                
                res.writeHead(json.success, headers);
                res.end(JSON.stringify(
                        _parseTimes(requestPayload["channel_id"])));
            }

            // Otherwise, request other periods from MySQL server.
            else{
                sql.fetchPeriodTimes(requestPayload["channel_id"], 
                        req.headers["period"], res);
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

                const channelId = requestPayload["channel_id"];
                const viewer = req.headers["viewerqueriedfor"];
                let response = undefined;
                let isWhitelisted = 
                        whitelisted[channelId].hasOwnProperty(viewer);

                // Swap tables for the viewer on the MySQL server.
                sql.swapViewer(requestPayload["channel_id"], 
                        viewer, isWhitelisted);

                // If user wan't whitelisted before, whitelist them now
                if(!isWhitelisted){

                    whitelisted[channelId][viewer] = 
                            trackers[channelId][viewer];
                    delete trackers[channelId][viewer];
                    response = "True";
                }

                // If user was whitelisted, unwhitelist them
                else{
                    
                    trackers[channelId][viewer] = 
                            whitelisted[channelId][viewer];
                    delete whitelisted[channelId][viewer];
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
            const viewerQueriedFor = req.headers["viewerqueriedfor"];
            const channelId = requestPayload["channel_id"];
            let isWhitelisted = undefined;

            // Checks whether or not user was whitlisted.
            if(trackers[channelId].hasOwnProperty(viewerQueriedFor)){
                res.setHeader("whitelisted", "False");
                isWhitelisted = false;
            }
            else{
                res.setHeader("whitelisted", "True");
                isWhitelisted = true;
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
            
            res.setHeader("viewerqueriedfor", viewerQueriedFor);

            sql.fetchLongTable(channelId, viewerQueriedFor, isWhitelisted, res);
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

            const channelId = requestPayload["channel_id"];

            const responsePayload = {
                viewers: [],
            };

            // This is super slow. Like, m*n slow where m is the length
            // of the names and n is the amount of names. Don't know that
            // time complexity of includes though. There's probably a better
            // way the search for matching names.
            for(let viewer in trackers[channelId]){
                if(viewer.includes(req.headers["viewerqueriedfor"])){
                    let viewVal = trackers[channelId][viewer];
                    if(viewVal != undefined){

                        responsePayload["viewers"].push([viewer, 
                                viewVal["time"]]); 

                    }
                    else{
                        responsePayload["viewers"].push([viewer, 0]);
                    }
                }
            }
            for(let viewer in whitelisted[channelId]){
                if(viewer.includes(req.headers["viewerqueriedfor"])){
                    let viewVal = whitelisted[channelId][viewer];
                    if(viewVal != undefined){

                        responsePayload["viewers"].push([viewer, 
                                viewVal["time"]]); 

                    }
                    else{
                        responsePayload["viewers"].push([viewer, 0]);
                    }
                }
            }

            res.writeHead(json.success, headers);
            res.end(JSON.stringify(responsePayload));
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
            const viewer = req.headers["viewerqueriedfor"];
            const channelId = requestPayload["channel_id"];
            let isWhitelisted = false;

            // Check if request from actualy from the client that's being 
            // paused.
            if(trackers[channelId][viewer] != undefined){
                if(requestPayload["user_id"] != 
                        trackers[channelId][viewer].user){
                    res.writeHead(json.forbidden);
                    res.end();
                    logger.info(`Illegal attempt: User ID does not match - `
                            + `toggleTracker: ${req["headers"]}`);
                    return;
                }
            }

            else if(whitelisted[channelId][viewer] != undefined){
                if(requestPayload["user_id"] != 
                        whitelisted[channelId][viewer].user){
                    res.writeHead(json.forbidden);
                    res.end();
                    logger.info(`Illegal attempt: User ID does not match - `
                            + `toggleTracker: ${req["headers"]}`);
                    return;
                }
                isWhitelisted = true;
            }

            // User doesn't exist
            else{
                res.writeHead(json.notFound);
                res.end();
                return;
            }

            // Viewer unpaused the stream. Start accumulating time again.
            if(req.headers["paused"] == "false"){

                if(!isWhitelisted){
                    trackers[channelId][viewer].prevNow = Date.now();
                    trackers[channelId][viewer].unpauseTime();
                }
                else{
                    whitelisted[channelId][viewer].prevNow = Date.now();
                    whitelisted[channelId][viewer].unpauseTime();
                }

            }

            // User paused the stream. Stop accumulating time.
            else{
               
                if(!isWhitelisted){
                    trackers[channelId][viewer].pauseTime();
                }
                else{
                    whitelisted[channelId][viewer].pauseTime();
                }

            }
            res.writeHead(json.success, headers);
            res.end();
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
            res.writeHead(json.success, {
                "Content-Type": "text/plain"
            });
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

                // user_id is apparently the same as channel_id. Wish I'd known
                // that earlier.
                const channelId = urlSplit[json.pathChannelIdIndex];

                // Parse query string into object format.
                let data = JSON.parse(body)["data"][0];

                // If stream is online
                if(data != undefined){
                   
                    // Check if new session started.
                    if(data["started_at"] != isOnline[channelId]){

                        // Settup for new session.
                        isOnline[channelId] = 
                                data["started_at"];
                        for(let user in trackers[channelId]){
                            trackers[channelId][user] = undefined;
                        }
                        for(let user in whitelisted[channelId]){
                            whitelisted[channelId][user] = undefined;
                        }
                    }

                    return;
                }

                isOnline[urlSplit[json.pathChannelIdIndex]] = undefined;

                // Update daily times which will be added to the MySQL server
                // at the end of the day. 
                updateDaily(channelId, false);

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

    for(let channelId in daily){

        updateDaily(channelId);

        // Pass in each channel to SQL function to update.
        sql.updateGraphTable(channelId, daily[channelId]);
    }

    // update all appropriate times from trackers and whitelisted
    // in the broadcaster's SQL tables.
    sql.updateTime(trackers, whitelisted);
}

/**
 * Updates "daily" object with "dailyTime" field from TimeTrackers for a 
 * specific channel. 
 * @param {string} channelId Id of channel to updates times for.
 * @param {boolean} online [true] If stream is online. Determines whether or not
 *                  to stop TimeTrackers. Stops TimeTrackers if false.
 */
function updateDaily(channelId, online=true){
    
    for(let viewer in trackers[channelId]){

        const userVal = trackers[channelId][viewer];

        // If the viewer has a TimeTracker attached to them, reset that
        // tracker's daily time to 0.
        if(userVal != undefined){
            
            daily[channelId][viewer] += userVal.dailyTime;
            userVal.dailyTime = 0;
            if(!online){
                userVal.stopTime();
            }
        }
    }

    // Same thing for those whitelisted.
    for(let viewer in whitelisted[channelId]){

        const userVal = whitelisted[channelId][viewer];

        if(userVal != undefined){
            daily[channelId][viewer] += userVal.dailyTime;
            userVal.dailyTime = 0;
            if(!online){
                userVal.stopTime();
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
    const callback = encodeURIComponent(`${json.webServerURL}:${json.https}`
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
 * Checks if webhook subscriptions need to be renewed. To be called every time 
 * the access token is renewed (daily). If in the off chance that the server is
 * down for an extended period of time (more than a day), a manual inspection
 * of subscriptions is required.
 */
function checkWebhooks(){
    
    const reqOptions = {
        "host": json.apiURL,
        "path": json.getWebhooksPath,
        "method": "GET",
        "headers": {
            "Authorization": "Bearer " + accessToken,
        },
    };

    const req = https.request(reqOptions, function(res){

        let data = "";
        res.on("data", function(chunk){

            data += chunk;

            // Either something went wrong or someone is attempting
            // to overflow the server.
            if(data.length > 1e6){
                logger.fatal(`Overflow attempt - checkWebhooks: `
                        + `ORIGIN: ${req["Origin"]}`);
                request.connection.destroy();
            }

        });

        res.on("end", function(){
        
            logger.info("GET webhooks request ended.\n"
                    + `\tStatus code: ${res.statusCode}\n`
                    + `\tMessage: ${res.statusMessage}`);

            data = JSON.parse(data)["data"];
           
            // Channels for which the webhooks need to be renewed.
            let toRenew = [];

            let date = new Date();
            for(let webhook of data){

                // Parse for date of expiration.
                let dateSplit = webhook["expires_at"].split(json.dateDelimiter);
                let exYear = parseInt(dateSplit[0]);
                let exMonth = parseInt(dateSplit[1]);
                let exDate = parseInt((dateSplit[json.dateIndex].
                        split(json.timeDelimiter))[0]);
                let expires = new Date(exYear, exMonth - 1, exDate);

                // If date difference is past a threshold, must renew.
                if(dateDifference(date, expires) <= json.renewalDays){
                    toRenew.push((webhook["callback"].split(
                            json.pathDelimiter))[json.checkChannelIdIndex]);
                }
            }

            multiStreamWebhook(toRenew);
            logger.info(`Renewed webhooks for ${toRenew}`);
            
        });

    });

    req.on("error", function(err){
        logger.error(`Failed attempt - checkWebhooks: ${err}`);
    });

    req.end();
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
            accessToken = data["access_token"];
            checkWebhooks();
        });

    });

    req.on("error", function(err){
        logger.error(`Failed attempt - getBearerToken: ${err}`);
    });

    req.end();
}

/**
 * Get the difference between two dates.
 * @param {!Date} date1 Date object.
 * @param {!Date} date2 Another date object.
 * @return the number of days between both dates rounded down.
 */
function dateDifference(date1, date2){
    const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), 
            date1.getDate());
    const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), 
            date2.getDate());

    return Math.floor((utc2 - utc1) / _MS_PER_DAY);
}

/**
 * Helper function to parse times from trackers and whitelisted objects.
 * Needed because TimeTrackers are circular objects so we can't directly
 * call JSON.stringify on them.
 * @param {String} channelId Channel to get viewer times for.
 * @return an object with one key value pair where the value is an array of
 *         arrays. The inner arrays have two values. [0]: The name of the user.
 *         [1]: Their session time.
 */
function _parseTimes(channelId){

    times = {
        viewers: []
    };
    for(let user in trackers[channelId]){

        if(trackers[channelId][user] != undefined){
            times["viewers"].push([user, trackers[channelId][user]["time"]]);
        }
        else{
            times["viewers"].push([user, 0]);
        }

    }

    return times;

}

/**
 * Helper function to check if the JWT from the client is valid.
 * @param {IncomingMessage} req Request from client that contains the JWT.
 * @param {ServerResponse} res Response to client. Used to writeHead and end if
 *                         JWT isn't valid.
 * @return false if JWT is not valid. True otherwise.
 */
function _checkJWT(req, res){

    if(req.headers["extension-jwt"] == undefined || 
            !jwt.verifyJWT(req.headers["extension-jwt"],
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
