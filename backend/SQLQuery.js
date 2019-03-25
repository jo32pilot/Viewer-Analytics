/**
 * @fileoverview Defines MySQL queries as functions using the 
 * [mysql](https://www.npmjs.com/package/mysql) package to make code 
 * cleaner and easier to maintain.
 */

const sql = require("mysql");
const log4js = require("log4js");
const flatted = require("flatted");
const json = require("./config.json");

module.exports = {
    startConnections: startConnections,
    fetchTables: fetchTables,
    fetchLongTable: fetchLongTable,
    fetchPeriodTimes: fetchPeriodTimes,
    addStreamerTable: addStreamerTable,
    addViewer: addViewer,
    swapViewer: swapViewer,
    createStreamerList: createStreamerList,
    updateStreamerList: updateStreamerList,
    fetchStreamerList: fetchStreamerList,
    createGraphTable: createGraphTable, 
    updateGraphTable: updateGraphTable,
    addViewerGraphTable: addViewerGraphTable,
    clearWeek: clearWeek,
    clearMonth: clearMonth,
    updateTime: updateTime,
    endConnections: endConnections,
};

/**
 * Suffix to append to channel ids to identify a channel's table as
 * the non-whitelist variant of viewer time storage.
 * @const
 */
const _REGULAR_SUFFIX = "R";

/**
 * Suffix to append to channel ids to identify a channel's table as
 * the whitelist variant of viewer time storage.
 * @const
 */
const _WHITELIST_SUFFIX = "WS";

/**
 * Suffix to append to channel ids to identify a channel's table as
 * the daily variant of viewer time storage. These tables are used
 * to create line graphs to visualize viewer watch habits.
 * @const
 */
const _GRAPH_SUFFIX = "G";


// Set up logging
log4js.configure({
    appenders: {
        everything: {
            type: "file", 
            filename: "server.log",
            maxLogSize: json.maxBytes,
            backups: json.maxBackups
        }
    },
    categories:{
        default: {
            appenders: ["everything"],
            level: "info"
        }
    }
});
const logger = log4js.getLogger("SQL");


let pool = undefined;     //Connection pool to MySQL server

let aliveConnections = 0; // Int denoting number of unreleased connections.

/**
 * Creates connection pool to mysql server. Could have just initialized
 * pool on require but having to explicitly start connections helps to
 * remind to end them as well.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function startConnections(){

    try{
        pool = sql.createPool({

            connectionLimit: json.limit,
            host: json.SQLHost,
            user: json.SQLUser,
            password: json.SQLPassword,
            database: json.database,
            port: json.SQLPort

        });
    }
    catch(error){
        logger.error(`Failed attempt - Pool initialization: ${error.message}`);
        return true;
    }

    return false;

}

/**
 * Gets times from database for all streams in stream and populates passed in
 * object with the data.
 *
 * @param {Array} streams Array of stream ids to get data for.
 *
 * @param {!Object<string, <string, !TimeTracker>>} regular
 *          Generic object to populate nonwhitelisted users with.
 *
 * @param {!Object<string, <string, !TimeTracker>>} whitelisted 
 *          Generic object to populate whitelisted users with.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function fetchTables(streams, regular, whitelisted){

    let toReturn = false;

    // Will always add another alive connection at the start of each function.
    aliveConnections++;

    pool.getConnection(function(err, connection){

        // If error occurs, connection doesn't exist, so no need to release.
        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }

        for(let stream of streams){

            // Get the table of stream
            connection.query("SELECT username FROM ?;", 
                    [sql.raw(stream + _REGULAR_SUFFIX)], 
                    function(error, results, fields){
                
                if(_assertError(error, connection)){
                    toReturn = true;
                    return;
                }

                regular[stream] = {};
                for(let row of results){
                    
                    // Populate stream's associative array with username as key
                    // and possibly a TimeTracker if the viewer is watching.
                    regular[stream][row.username] = undefined;

                }

            });

            connection.query("SELECT username FROM ?;", 
                    [sql.raw(stream + _WHITELIST_SUFFIX)],
                    function(error, results, fields){

                if(_assertError(error, connection)){
                    toReturn = true;
                    return;
                }

                whitelisted[stream] = {};
                for(let row of results){
                    
                    // Same as when populating regular.
                    whitelisted[stream][row.username] = undefined;

                }
            });
        }

        connection.release();
        aliveConnections--;

    });

    return toReturn;
}

/**
 * Gets week, month, year, and overall accumulated times for each person.
 * @param {string} stream Channel id of streamer to fetch data for.
 * @param {string} viewerUsername Name of user to get stats for.
 * @param {ServerResponse} res Server response object used to send payload
 *                         received from the MySQL server to the client.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function fetchLongTable(channelId, viewerUsername, res){

    let toReturn = false;

    // Label tables to identify
    const regTable = sql.raw(channelId + _REGULAR_SUFFIX);
    const graphTable = sql.raw(channelId + _GRAPH_SUFFIX);
    aliveConnections++;

    pool.getConnection(function(err, connection){
    
        if(_assertConnectionError(err, res)){
            toReturn = true;
            return;
        }

        // Initialize response payload to fill viewer data with.
        const responsePayload = {}
        connection.query("SELECT username, week, month, year, all_time FROM ? "
                + "WHERE username=?;", 
                [regTable, viewerUsername], function(error, results, fields){
    
            if(_assertError(error, connection, res)){
                toReturn = true;
                return;
            }

            responsePayload["longStats"] = results;

        });

        // Fetch data for graph.
        connection.query("SELECT * FROM ? WHERE username=?;", 
                [graphTable, viewerUsername], function(error, results, fields){

            if(_assertError(error, connection, res)){
                toReturn = true;
                return;
            }

            responsePayload["graphStats"] = results;

            // Send MySQL response to client
            res.writeHead(json.success, json.headers);
            res.end(flatted.stringify(results)); 

        });

        aliveConnections--;
        connection.release();
    });

    return toReturn;

}

/**
 * Gets a specfied the list of accumulated times for any given period other
 * than the current session.
 * @param {string} channelId Channel to get viewer times for.
 * @param {string} period Period of time in which users accumulated time.
 *                 (e.g. week, year)
 * @param {ServerResponse} res Response object to send data back to client.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function fetchPeriodTimes(channelId, period, res){

    let toReturn = false;

    const regTable = sql.raw(channelId + _REGULAR_SUFFIX);
    const graphTable = sql.raw(channelId + _GRAPH_SUFFIX);
    aliveConnections++;

    pool.query("SELECT username, ? from ?;", [period, regTable], 
            function(err, results, fields){

        if(_assertConnectionError(err, res)){
            toReturn = false;
            return;
        }

        res.writeHead(json.success, json.headers);
        res.end(flatted.stringify(results));

    });
    
    return toReturn;

}

/**
 * Creates a tables on the MySQL server. Each table created by this function
 * belongs to the streamer whose id was input. Tables contain viewers'
 * ids, usernames, and accumulated times. Those on the whitelist will not
 * be shown on the leaderboard.
 * @param {string} channelId Unique id of streamer's channel to name the table.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function addStreamerTable(channelId){

    let toReturn = false;

    const channelIdRegular = sql.raw(channelId + _REGULAR_SUFFIX);
    const whitelistId = sql.raw(channelId + _WHITELIST_SUFFIX);
    aliveConnections++;

    pool.getConnection(function(err, connection){

        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }
        
        // Create table which stores viewer accumulated times.
        connection.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
                + "username VARCHAR(50) NOT NULL UNIQUE, "
                + "week INT DEFAULT 0, month INT DEFAULT 0, "
                + "year INT DEFAULT 0, "
                + "all_time INT DEFAULT 0, PRIMARY KEY(id));",
                [channelIdRegular], function(error){

            if(_assertError(error, connection)){
                toReturn = true;
                return;
            }

        });

        // Create table which stores accumulated times for whitelisted viewers.
        connection.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
                + "username VARCHAR(50) NOT NULL UNIQUE, "
                + "week INT DEFAULT 0, "
                + "month INT DEFAULT 0, year INT DEFAULT 0, "
                + "all_time INT DEFAULT 0, PRIMARY KEY(id));",
                [whitelistId], function(error){
           
            if(_assertError(error, connection)){
                toReturn = true;
                return;
            }

        });

        connection.release();
        aliveConnections--;

    });

    return toReturn;
}

/**
 * Adds a new viewer to the streamer's table.
 * @param {string} channelId Unique id of streamer's channel to add viewer to.
 * @param {string} viewerId Unique id of viewer being added to the table.
 * @param {string} viewerUsername Display/login name of viewer being added to 
 *                 the table.
 * @param {!Array} times [[0, 0, 0, 0]] Weekly, monthly, yearly, and all time
 *                accumulated times, respectively. Should default to 
 *                [0, 0, 0, 0] if new viewer.
 * @param {boolean} whitelisted [false] Whether or not the user is being added
 *                  to the whitelist or not.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function addViewer(channelId, viewerId, viewerUsername, times=[0, 0, 0, 0], 
        whitelisted=false){
    
     let toReturn = false;

    // Change table suffix depending on whitelisted or not
    if(whitelisted){
        channelId = sql.raw(channelId + _WHITELIST_SUFFIX);
    }
    else{
        channelId = sql.raw(channelId + _REGULAR_SUFFIX);
    }

    aliveConnections++;
    
    pool.query("INSERT INTO ? VALUES (?, ?, ?);",
            [channelId, viewerId, viewerUsername, times], 
            function(error){
            
        aliveConnections--;

        if(_assertConnectionError(error)){
            toReturn = true;
            return;
        }

    });

    return toReturn;

}

/**
 * Removes user from regular table or whitelist table and puts them on the
 * table they were not on previously.
 * @param {string} channelId Unique id of streamer's channel of which the 
 *                 viewer to remove is in.
 * @param {string} viewerUsername Display/login name of viewer being removed
 *                 from the table.
 * @param {boolean} whitelisted [false] True if user is currently whitelisted,
 *                  false otherwise.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function swapViewer(channelId, viewerUsername, whitelisted=false){

    let toReturn = false;

    const regTable = sql.raw(channelId + _REGULAR_SUFFIX);
    const whitelistTable = sql.raw(channelId + _WHITELIST_SUFFIX);
    const removeFrom = undefined;

    if(whitelisted){
        removeFrom = whitelistTable;
    }
    else{
        removeFrom = regTable;
    }

    aliveConnections++;
    
    pool.getConnection(function(err, connection){
       
        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }

        // Initialize array to insert all times in.
        const times = [];
        let viewerId = undefined;
        connection.query("SELECT * FROM ? WHERE viewerUsername=?;",
                [removeFrom, viewerUsername], function(error, results, fields){
            
             if(_assertError(error, connection)){
                toReturn = true;
                return;
             }

             // Insert all times in times array.
             times.push(row.week);
             times.push(row.month);
             times.push(row.year);
             times.push(row.all_time);
             viewerId = row.id;
        });

        // Remove from previous table.
        connection.query("DELETE FROM ? WHERE viewerUsername=?;", 
                [removeFrom, viewerUsername], function(error){
        
            if(_assertError(error, connection)){
                toReturn = true;
                return;
            }
        });

        // Insert into new table.
        connection.query("INSERT INTO ? VALUES (?, ?, ?);", 
                [viewerId, viewerUsername, times], function(error){

            if(_assertError(error, connection)){
                toReturn = true;
                return;
            }
        });

        connection.release();
        aliveConnections--;
    });

    return toReturn;

}

/**
 * Creates table to store list of channel ids. Used for ease
 * of access of channel ids when restarting server if ever needed.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function createStreamerList(){

    let toReturn = false;

    aliveConnections++;

    pool.query("CREATE TABLE list_of_streamers(channel_id VARCHAR(50), "
            + "PRIMARY KEY(channel_id));", function(error){
        
        aliveConnections--;

        if(error && error.message == json.tableExists){
            return;
        }
        else if(_assertConnectionError(error)){
            toReturn = true;
            return;
        }

    });

    return toReturn;

}

/**
 * Updates list of channel ids with a new channel.
 * @param {string} channelId Unique id of streamer's channel to add.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export.
 */
function updateStreamerList(channelId){

    let toReturn = false;

    aliveConnections++;

    const query = "INSERT INTO list_of_streamers VALUES (?);";
    const args = [channelId];

    pool.query(query, args, function(error){ 
   
        aliveConnections--;

       if( _assertConnectionError(error)){
            toReturn = true;
            return;
       }

    });

    return toReturn;

}

/**
 * Gets all streamers' channel ids to be used for some callback.
 * @param {!Function} callback Action to perform after getting streamers.
 * @param {...args} args Additional arguments to be used for the callback.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function fetchStreamerList(callback, ...args){

    let toReturn = false;

    aliveConnections++;

    pool.query("SELECT channel_id FROM list_of_streamers;",
            function(error, results, fields){

        aliveConnections--;

        if(_assertConnectionError(error)){
            toReturn = true;
            return;
        }

        // Begin populating array with results from query
        const toPopulate = [];
        for(let row of results){
            toPopulate.push(row["channel_id"]);
        }

        callback(toPopulate, ...args);

    });

    return toReturn;

}

/**
 * Creates table to store accumulated time for each day. This data 
 * is send to the client to draw a graph of daily watch habits.
 * @param {string} channelId Broadcaster's id to identify who the table belongs
 *                 to.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function createGraphTable(channelId){

    let toReturn = false;

    channelId = sql.raw(channelId + _GRAPH_SUFFIX);
    aliveConnections++;

    pool.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
            + "username VARCHAR(50) NOT NULL UNIQUE, PRIMARY KEY(username));", 
            [channelId], function(err){

        aliveConnections--;

        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }
    });

    return toReturn;

}

/**
 * Should be called everyday at midnight. Updates graph table with that day's
 * accumulated time for each viewer.
 * @param {string} channelId Broadcaster's id to identify who the table belongs
 *                 to.
 * @param {!Object<string, int>} times Map with viewer ids as keys and their
 *                               accumulated times as values.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function updateGraphTable(channelId, times){

    let toReturn = false;

    // Get todays date to create new column in table
    const today = new Date();
    today = sql.raw(`${today.getMonth()}_${today.getDate()}_${today.getFulYear}`);

    channelId = sql.raw(channelId + _GRAPH_SUFFIX);
    aliveConnections++;

    pool.getConnection(function(err, connection){

        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }

        pool.query("ALTER TABLE ? ADD ? INT NOT NULL DEFAULT 0;",
                [channelId, today], function(error){
         
           if( _assertError(error, connection)){
                toReturn = true;
                return;
           }

        });
    
        // On the same connection, update each person's time.
        for(let viewer in times){
            pool.query("UPDATE ? SET ?=? WHERE username=?;", 
                    [channelId, today, times[viewer], viewer], function(error){
             
                if(_assertError(error, connection)){
                    toReturn = true;
                    return;
                }

            });
        }

        aliveConnections--;
        connection.release();

    });

    return toReturn;

}

/**
 * Add a new viewer to a graph table.
 * @param {string} channelId Broadcaster's id to identify who the table belongs
 *                 to.
 * @param {string} viewerId Id of viewer being added to the table.
 * @param {string} viewerUsername Username of viewer being added to the table.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function addViewerGraphTable(channelId, viewerId, viewerUsername){

    let toReturn = false;

    channelId = sql.raw(channelId + _GRAPH_SUFFIX);
    aliveConnections++;

    pool.query("INSERT INTO ? (id, username) VALUES (?, ?);",
            [channelId, viewerId, viewerUsername], function(err){
        
        aliveConnections--;
        
        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }
    });

    return toReturn;

}

/**
 * Clears week columns for all tables.
 * @export
 */
function clearWeek(){

    aliveConnections++;

    pool.getConnection(function(err, connection){

        if(_assertConnectionError(err)){
            return;
        }
        
        const streamersReg = [];
        const streamersWhitelist = [];
        connection.query("SELECT * FROM list_of_streamers;",
                function(error, results, fields){

            if(_assertError(error)){
                return;
            }

            for(let row of results){
                streamersReg.push(sql.raw(row["channel_id"] 
                        + _REGULAR_SUFFIX));
                streamersWhitelist.push(sql.raw(row["channel_id"] 
                        + _WHITELIST_SUFFIX));
            }

        });

        connection.query("UPDATE ?, ? SET week=0;", 
                [streamerReg, streamerWhitelist], function(error){
                
            if(_assertError(error)){
                return;
            }

        });

        aliveConnections--;
        connection.release();

    });

}

/**
 * Clears month columns for all tables.
 * @export
 */
function clearMonth(){

    aliveConnections++;

    pool.getConnection(function(err, connection){

        if(_assertConnectionError(err)){
            return;
        }
        
        const streamersReg = [];
        const streamersWhitelist = [];
        connection.query("SELECT * FROM list_of_streamers;",
                function(error, results, fields){

            if(_assertError(error)){
                return;
            }

            for(let row of results){
                streamersReg.push(sql.raw(row["channel_id"] 
                        + _REGULAR_SUFFIX));
                streamersWhitelist.push(sql.raw(row["channel_id"] 
                        + _WHITELIST_SUFFIX));
            }

        });

        connection.query("UPDATE ?, ? SET month=0;", 
                [streamerReg, streamerWhitelist], function(error){
                
            if(_assertError(error)){
                return;
            }

        });

        aliveConnections--;
        connection.release();

    });
}

/**
 * Updates the MySQL server with all times withing the passed in times 
 * object.
 * @param {!Object<string, <string, !TimeTracker>>} regular 
 *          Associative array with streamer channel ids as keys
 *          and another associative array as their values. The inner 
 *          associative array contains viewer display names as keys
 *          and an array containing accumulated time and possibly
 *          a time tracker as values.
 * @param {!Object<string, <string, !TimeTracker>>} whitelisted 
 *          Associative array similar to the regular 
 *          parameter but for whitelisted users.
 * @return {boolean} Returns true if error occurred. False otherwise.
 * @export
 */
function updateTime(regular, whitelisted){

    let toReturn = false;

    aliveConnections++;

    pool.getConnection(function(err, connection){
        
        if(_assertConnectionError(err)){
            toReturn = true;
            return;
        }


        // Update all times with current session time.
        // Index by username which are also unique.
        query = "UPDATE ? SET week=? + (SELECT week), "
                + "month=? + (SELECT month), year=? + (SELECT year), "
                + "all_time=? + (SELECT all_time) WHERE username=?;";

        // Go through each stream
        for(let stream in regular){

            streamRaw = sql.raw(stream + _REGULAR_SUFFIX);
            whitelistRaw = sql.raw(stream + _WHITELIST_SUFFIX);

            // Go through each person not whitelisted
            for(let viewer in regular[stream]){

                // Continue if viewer does not have a tracker
                if(regular[stream][viewer] == undefined){
                    continue;
                }

                // Gets times not yet added to the table then resets them
                // back to 0.
                sessionTime = regular[stream][viewer].timeNotAdded;
                regular[stream][viewer].timeNotAdded = 0;
                queryArgs = [streamRaw, sessionTime, sessionTime,
                             sessionTime, sessionTime, viewer];
                
                connection.query(query, queryArgs, function(error){
                 
                    if(_assertError(err, connection)){
                        toReturn = true;
                        return;
                    }

                });
            }

            // Go through each whitelisted person and do the same thing.
            for(let viewer in whitelisted[stream]){
                
                if(regular[stream][viewer] == undefined){
                    continue;
                }
                sessionTime = whitelisted[stream][viewer].timeNotAdded;
                whitelisted[stream][viewer].timeNotAdded = 0;
                queryArgs = [whitelistRaw, sessionTime, sessionTime,
                             sessionTime, sessionTime, viewer];

                connection.query(query, queryArgs, function(error){

                    if(_assertError(error, connection)){
                        toReturn = true;
                        return;
                    }

                });
            }
        }

        connection.release();
        aliveConnections--;

    });

    return toReturn;

}

/**
 * End connections in connection pool.
 * @export
 */
function endConnections(){
 
    // Periodically check if there are any more alive connections.
    let wait = setInterval(function(){
        
        // Once all connections are released clear the interval and end the
        // pool.
        if(aliveConnections == 0){
   
            log4js.shutdown(function(){});

            if(pool == undefined){
                clearInterval(wait);
            }

            pool.end(function(err){

                clearInterval(wait);
                
                if(err){
                    logger.error(error.message);
                }

            });
        }
    });
}

/**
 * Asserts if an error occurred and handles accordingly.
 * @param {!Error} err Error that occurred.
 * @param {!Connection} connection Connection to close if error occurred.
 * @param {!ServerResponse} [undefined] res Server response object to tell
 *                                      client error occurred if one did.
 *                                      
 * @return {boolean} Returns true if error occurred. False otherwise.
 */
function _assertError(err, connection, res=undefined){
    if(err){
        aliveConnections--;
        try{
            connection.release();
        }
        catch(error){
        }
        if(res != undefined){
            res.writeHead(json.badRequest);
            res.end();
        }
        logger.error(`Failed to query with connection: ${err.message}`);
        return true;
    }
    return false;
}

/**
 * Asserts if connection couldn't be made or if a query failed when calling
 * pool.query(). 
 * (assertError only handles query failures when calling pool.getConnection).
 * @param {!Error} err Error that occurred.
 * @param {!ServerResponse} [undefined] res Server response object to tell
 *                                      client error occurred if one did.
 * @return {boolean} Returns true if error occurred. False otherwise.
 */
function _assertConnectionError(err, res=undefined){
    if(err){
        aliveConnections--;
        if(res != undefined){
            res.writeHead(json.badRequest);
            res.end();
        }
        logger.error(`Could not establish connection: ${err.message}`);
        return true;
    }
    return false;
}
