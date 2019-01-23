const sql = require("mysql");
const json = require("./config.json");

const pool = sql.createPool({

    connectionLimit: json.limit,
    host: json.SQLHost,
    user: json.SQLUser,
    password: json.SQLPassword,
    database: json.database

});

function addStreamerTable(streamerid){

    pool.query("CREATE TABLE ?(id VARCHAR(50) NOT NULL UNIQUE, " 
            + "username VARCHAR(50) NOT NULL UNIQUE, time INT DEFAULT 0, "
            + "PRIMARY KEY(id));", streamerid, function(error){
        
        if(error){
            throw error;
        }

    });

}

function addViewer(streamerid, viewerid, viewerUserName){

    pool.getConnection(function(err, connection){

        // Not connected in the first place, no need to close connection.
        if(err){
            throw err;
        }

        // Aquire lock to prevent primary key violation as multiple 
        // connections / threads are manipulating the table.
        connection.query("LOCK TABLES ? WRITE;", streamerid, function(error){
        
            _assertError(error, connection);

        });

        connection.query("INSERT INTO ? (id, username) VALUES (?, ?);"
                [streamerid, viewerid, viewerUserName], function(error){

            _assertError(error, connection);

        });

        connection.query("UNLOCK TABLES;" function(error){
        
            _assertError(error, connection);

        });

        connection.release();

    });
    
}

function updateTime(streamerid, viewerid){

    pool.query("");

}

function _assertError(err, connection){
    if(err){
        connection.release();
        throw err;
    };
}
