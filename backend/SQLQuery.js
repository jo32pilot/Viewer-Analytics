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

            connection.query("SELECT * FROM ?;", [sql.raw(stream)], 
                    function(error, results, fields){
                
                //be sure to catch all of the thrown errors in
                //the main file and to shut down the server gracefully.
                _assertError(error, connection);

                toPopulate[stream] = {};
                for(let row of results){
                    
                    toPopulate[stream][row.username] = row.time;

                }

            });
        }

        connection.release();
        aliveConnections--;

    });

}

//also add them to watchedStream table.


function addStreamerTable(streamerid){

    streamerid = sql.raw(streamerid);
    aliveConnections++;

    pool.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
            + "username VARCHAR(50) NOT NULL UNIQUE, time INT DEFAULT 0, "
            + "PRIMARY KEY(id));", [streamerid], function(err){
        
        if(err){
            aliveConnections--;
            throw err;
        }
        
    });

    aliveConnections--;

}

function addViewer(streamerid, viewerid, viewerUserName){

    streamerid = sql.raw(streamerid);

    aliveConnections++;
    
    pool.query("INSERT INTO ? VALUES (?, ?, ?);",
            [streamerid, viewerid, viewerUserName, 0], function(error){

        if(error){
            aliveConnections--;
            throw error;
            //log this
        }

    });

    aliveConnections--;

}

function updateTime(times){

    aliveConnections++;

    pool.getConnection(function(err, connection){
        
        if(err){
            aliveConnections--;
            throw err;
        }

        for(let stream in times){

            streamRaw = sql.raw(stream);

            for(let viewer in times[stream]){

                connection.query("UPDATE ? SET time=? WHERE id=?;", 
                        [streamRaw, times[stream][viewer], viewer], 
                        function(error){
                 
                    _assertError(err, connection);

                });
            }
        }

        connection.release();
        aliveConnections--;

    });
}

function endConnections(callback){

    let wait = setInterval(function(){
        
        if(aliveConnections == 0){
   
            if(pool == undefined){
                clearInterval(wait);
                callback(0);
            }

            pool.end(function(err){

                clearInterval(wait);

                // Assuming the callback will be process.exit
                callback(0);                
                //log error

            });
    
        }

    });

}

function _assertError(err, connection){
    if(err){
        aliveConnections--;
        connection.release();
        throw err;
    };
}
