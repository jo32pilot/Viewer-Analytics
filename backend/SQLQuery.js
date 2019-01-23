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

    pool.query("INSERT INTO ? (id, username) VALUES (?, ?);"
            [streamerid, viewerid, viewerUserName], function(error){

        throw err;
        //log this

    });

}

function updateTime(streamerid, viewerid, time){

    pool.query("");

}

function _assertError(err, connection){
    if(err){
        connection.release();
        throw err;
    };
}
