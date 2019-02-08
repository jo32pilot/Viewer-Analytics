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
    addStreamerTable: addStreamerTable,
    addViewer: addViewer,
    createStreamerList: createStreamerList,
    updateStreamerList: updateStreamerList,
    fetchStreamerList: fetchStreamerList,
    updateTime: updateTime,
    endConnections: endConnections,
};


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
 * @param {Object} toPopulate Generic object to populate data with.
 */
function fetchTables(streams, toPopulate){

    aliveConnections++;

    pool.getConnection(function(err, connection){

        // If error occurs, connection doesn't exist, so no need to release.
        if(err){
            aliveConnections--;
            throw err;
        }

        for(let stream of streams){

            // Get the table of stream
            connection.query("SELECT * FROM ?;", [sql.raw(stream)], 
                    function(error, results, fields){
                
                _assertError(error, connection);

                toPopulate[stream] = {};
                for(let row of results){
                    
                    // Populate stream's associative array with username as key
                    // and an array containing the user's time as the value.
                    // We attach a time tracker as the second element in the 
                    // user's array later
                    toPopulate[stream][row.username] = [row.time];

                }

            });
        }

        connection.release();
        aliveConnections--;

    });

}

/**
 * Creates a table on the MySQL server. Each table created by this function
 * belongs to the streamer whose id was input. Tables contain viewers'
 * ids, usernames, and accumulated times.
 * @param {String} channelId Unique id of streamer's channel to name the table.
 */
function addStreamerTable(channelId){

    channelId = sql.raw(channelId);
    aliveConnections++;

    pool.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
            + "username VARCHAR(50) NOT NULL UNIQUE, time INT DEFAULT 0, "
            + "PRIMARY KEY(id));", [channelId], function(err){
        
        aliveConnections--;
        
        if(err){
            throw err;
        }
    });
}

/**
 * Adds a new viewer to the streamer's table.
 * @param {String} channelId Unique id of streamer's channel to add viewer to.
 * @param {String} viewerId Unique if of viewer being added to the table.
 * @param {String} viewerUsername Display/login name of viewer being added to 
 *                 the table.
 */
function addViewer(channelId, viewerId, viewerUsername){

    channelId = sql.raw(channelId);
    aliveConnections++;
    
    pool.query("INSERT INTO ? VALUES (?, ?, ?);",
            [channelId, viewerId, viewerUsername, 0], function(error){
            
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

        if(error){
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
 * @param {Object} Associative array with streamer channel ids as keys and
 *                 another associative array as their values. The inner 
 *                 associative array contains viewer display names as keys
 *                 and an array containing accumulated time and possibly
 *                 a time tracker as values.
 */
function updateTime(times){

    aliveConnections++;

    pool.getConnection(function(err, connection){
        
        if(err){
            aliveConnections--;
            throw err;
        }

        // Go through each stream
        for(let stream in times){

            streamRaw = sql.raw(stream);

            // Go through each person
            for(let viewer in times[stream]){

                // Index by username which are also unique
                connection.query("UPDATE ? SET time=? WHERE username=?;", 
                        [streamRaw, times[stream][viewer][0], viewer], 
                        function(error){
                 
                    _assertError(err, connection);

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
        connection.release();
        throw err;
    };
}
