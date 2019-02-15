/**
 * @fileoverview Defines functions to act as shortcuts for MySQL commands.
 * Dependencies:
 *      - [mysql](https://www.npmjs.com/package/mysql)
 */

const sql = require("mysql");
const json = require("./config.json");

module.exports = {
    startConnections: startConnections,
    fetchTables: fetchTables,
    fetchLongTable: fetchLongTable,
    addStreamerTable: addStreamerTable,
    addViewer: addViewer,
    createStreamerList: createStreamerList,
    updateStreamerList: updateStreamerList,
    fetchStreamerList: fetchStreamerList,
    updateTime: updateTime,
    endConnections: endConnections,
};

const _REGULAR_SUFFIX = "R";
const _WHITELIST_SUFFIX = "WS";

let pool = undefined; //Connection pool to MySQL server

let aliveConnections = 0; // Int denoting number of unreleased connections.

/**
 * Creates connection pool to mysql server. Could have just initialized
 * pool on require but having to explicitly start connections helps to
 * remind to end them as well.
 */
function startConnections(){

    pool = sql.createPool({

        connectionLimit: json.limit,
        host: json.SQLHost,
        user: json.SQLUser,
        password: json.SQLPassword,
        database: json.database

    });

}

/**
 * Gets times from database for all streams in stream and populates passed in
 * object with the data.
 * @param {Array} streams Array of stream ids to get data for.
 * @param {Object} regular Generic object to populate nonwhitelisted users
 *                 with.
 * @param {Object} whitelisted Generic object to populate whitelisted users 
 *                 with.
 */
function fetchTables(streams, regular, whitelisted){

    aliveConnections++;

    pool.getConnection(function(err, connection){

        // If error occurs, connection doesn't exist, so no need to release.
        if(err){
            aliveConnections--;
            throw err;
        }

        for(let stream of streams){

            // Get the table of stream
            connection.query("SELECT username FROM ?;", 
                    [sql.raw(stream + _REGULAR_SUFFIX)], 
                    function(error, results, fields){
                
                _assertError(error, connection);

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

                _assertError(error, connection);

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
}

/**
 * Gets week, month, year, and overall accumulated times for each person.
 * @param {String} stream Channel id of streamer to fetch data for.
 * @param {ServerResponse} res Server response object used to send payload
 *                         received from the MySQL server to the client.
 */
function fetchLongTable(channelId, res){

    channelId = sql.raw(channelId + _REGULAR_SUFFIX);
    aliveConnections++;

    pool.query("SELECT username, week, month, year, all_time FROM ?;", 
            [channelId], function(err, results, fields){

        if(err){
            aliveConnections--;
            throw err;
        }

        // Send MySQL response to client.
        res.end(JSON.stringify(results)); 
        aliveConnections--;

    });

}


/**
 * Creates a tables on the MySQL server. Each table created by this function
 * belongs to the streamer whose id was input. Tables contain viewers'
 * ids, usernames, and accumulated times. Those on the whitelist will not
 * be shown on the leaderboard.
 * @param {String} channelId Unique id of streamer's channel to name the table.
 */
function addStreamerTable(channelId){

    const channelIdRegular = sql.raw(channelId + _REGULAR_SUFFIX);
    const whitelistId = sql.raw(channelId + _WHITELIST_SUFFIX);
    aliveConnections++;

    pool.getConnection(function(err, connection){

        if(err){
            aliveConnections--;
            throw err;
        }
        
        // Create table which stores viewer accumulated times.
        connection.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
                + "username VARCHAR(50) NOT NULL UNIQUE, "
                + "week INT DEFAULT 0, month INT DEFAULT 0, "
                + "year INT DEFAULT 0, "
                + "all_time INT DEFAULT 0, PRIMARY KEY(id));",
                [channelIdRegular], function(error){

            _assertError(error, connection);

        });

        // Create table which stores accumulated times for whitelisted viewers.
        connection.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
                + "username VARCHAR(50) NOT NULL UNIQUE, "
                + "week INT DEFAULT 0, "
                + "month INT DEFAULT 0, year INT DEFAULT 0, "
                + "all_time INT DEFAULT 0, PRIMARY KEY(id));",
                [whitelistId], function(error){
           
            _assertError(error, connection);

        });

        connection.release();
        aliveConnections--;

    });
}

/**
 * Adds a new viewer to the streamer's table.
 * @param {String} channelId Unique id of streamer's channel to add viewer to.
 * @param {String} viewerId Unique if of viewer being added to the table.
 * @param {String} viewerUsername Display/login name of viewer being added to 
 *                 the table.
 * @param {boolean} whitelisted [false] Whether or not the user is being added
 *                  to the whitelist or not.
 */
function addViewer(channelId, viewerId, viewerUsername, whitelisted=false){

    if(whitelisted){
        channelId = sql.raw(channelId + _WHITELIST_SUFFIX);
    }
    else{
        channelId = sql.raw(channelId + _REGULAR_SUFFIX);
    }

    aliveConnections++;
    
    pool.query("INSERT INTO ? VALUES (?, ?, ?, ?, ?, ?);",
            [channelId, viewerId, viewerUsername, 0, 0, 0, 0], 
            function(error){
            
        aliveConnections--;

        if(error){
            throw error;
            //log this
        }
    });
}

/**
 * Creates table to store list of streamer channel ids. Used for ease
 * of access of channel ids when restarting server if ever needed.
 */
function createStreamerList(){

    aliveConnections++;

    pool.query("CREATE TABLE list_of_streamers(channel_id VARCHAR(50), " + 
            "PRIMARY KEY(channel_id));", function(error){
        
        aliveConnections--;

        if(error && error.message != json.tableExists){
            throw error;
        }
    });
}

/**
 * Updates list of channel ids with a new channel id.
 * @param {String} channelId Unique id of streamer's channel to add.
 */
function updateStreamerList(channelId){

    aliveConnections++;

    pool.query("INSERT INTO list_of_streamers VALUES (?);", [channelId],
            function(error){
   
        aliveConnections--;

        if(error){
            throw error;
        }
    });
}

/**
 * Gets all streamers' channel ids.
 * @param {Array} toPopulate Array to populate streamer channel ids with.
 */
function fetchStreamerList(toPopulate){

    aliveConnections++;

    pool.query("SELECT * FROM list_of_streamers;", 
            function(error, results, fields){

        aliveConnections--;

        if(error){
            throw error;
        }
     
        for(let row of results){
            
            toPopulate.push(row["channel_id"]);

        }
    });
}

/**
 * Updates the MySQL server with all times withing the passed in times 
 * object.
 * @param {Object} regular Associative array with streamer channel ids as keys
 *                 and another associative array as their values. The inner 
 *                 associative array contains viewer display names as keys
 *                 and an array containing accumulated time and possibly
 *                 a time tracker as values.
 * @param {Object} whitelisted Associative array similar to the regular 
 *                 parameter but for whitelisted users.
 */
function updateTime(regular, whitelisted){

    aliveConnections++;

    pool.getConnection(function(err, connection){
        
        if(err){
            aliveConnections--;
            throw err;
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

                if(regular[stream][viewer] == undefined){
                    continue;
                }
                sessionTime = regular[stream][viewer].time;
                queryArgs = [streamRaw, sessionTime, sessionTime,
                             sessionTime, sessionTime, viewer];
                
                connection.query(query, queryArgs, function(error){
                 
                    _assertError(err, connection);

                });
            }

            // Go through each whitelisted person
            for(let viewer in whitelisted[stream]){
                
                if(regular[stream][viewer] == undefined){
                    continue;
                }
                sessionTime = whitelisted[stream][viewer].time;
                queryArgs = [whitelistRaw, sessionTime, sessionTime,
                             sessionTime, sessionTime, viewer];

                connection.query(query, queryArgs, function(error){

                    _assertError(error, connection);

                });
            }
        }

        connection.release();
        aliveConnections--;

    });
}

/**
 * End connections in connection pool.
 */
function endConnections(){
 
    // Periodically check if there are any more alive connections.
    let wait = setInterval(function(){
        
        // Once all connections are released clear the interval and end the
        // pool.
        if(aliveConnections == 0){
   
            if(pool == undefined){
                clearInterval(wait);
            }

            pool.end(function(err){

                clearInterval(wait);
                //log error

            });
        }
    });
}

/**
 * Asserts if an error occurred and handles accordingly.
 * @param {Object} err Error that occurred.
 * @param {Object} connection Connection to close if error occurred.
 */
function _assertError(err, connection){
    if(err){
        aliveConnections--;
        try{
            connection.release();
        }
        catch(error){
        }
        throw err;
    };
}
