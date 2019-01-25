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



let pool = undefined;
let aliveConnections = [];

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
 * @param {Array} Array of stream ids to get data for.
 * @param {Object} Object to populate data with.
 */
function fetchTables(streams, toPopulate){

    aliveConnections.push(true);

    pool.getConnection(function(err, connection){

        if(err){
            aliveConnections.pop();
            throw err;
        }

        for(let stream of streams){

            connection.query("SELECT * FROM ?;", [sql.raw(stream)], 
                    function(error, results, fields){
                
                //be sure to catch all of the thrown errors in
                //the main file and to shut down the server gracefully.
                _assertError(error, connection);

                console.log(results);

                toPopulate[stream] = {};
                for(let row of results){
                    
                    toPopulate[stream][row.username] = row.time;

                }

            });
        }

        connection.release();
        aliveConnections.pop();

    });

}

//also add them to watchedStream table.


function addStreamerTable(streamerid){

    streamerid = sql.raw(streamerid);
    aliveConnections.push(true);

    pool.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
            + "username VARCHAR(50) NOT NULL UNIQUE, time INT DEFAULT 0, "
            + "PRIMARY KEY(id));", [streamerid], function(err){
        
        if(err){
            aliveConnections.pop();
            throw err;
        }
        
    });

    aliveConnections.pop();

}

function addViewer(streamerid, viewerid, viewerUserName){

    streamerid = sql.raw(streamerid);

    aliveConnections.push(true);
    
    pool.query("INSERT INTO ? VALUES (?, ?, ?);",
            [streamerid, viewerid, viewerUserName, 0], function(error){

        if(error){
            aliveConnections.pop()
            throw error;
            //log this
        }

    });

    aliveConnections.pop();

}

function updateTime(times){

    aliveConnections.push(true);

    pool.getConnection(function(err, connection){
        
        if(err){
            aliveConnections.pop();
            throw err;
        }

        for(let stream in times){

            stream = sql.raw(stream);

            for(let viewer in stream){

                viewer = sql.raw(viewer);
                connection.query("UPDATE ? SET time=? WHERE id=?;", 
                        [stream, stream[viewer], viewer], function(error){
                 
                    _assertError(err, connection);

                });
            }
        }

        connection.release();
        aliveConnections.pop();

    });
}

function endConnections(){

    let wait = setInterval(function(){

        if(aliveConnections.length == 0){
    
            pool.end(function(err){

                //log error
                console.log("Ended");

            });

            clearInterval(wait);
    
        }

    });

}

function _assertError(err, connection){
    if(err){
        aliveConnections.pop();
        connection.release();
        throw err;
    };
}
