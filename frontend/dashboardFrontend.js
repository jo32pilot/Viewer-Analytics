/**
 * @fileoverview Handles frontend interaction between broadcaster and the
 * the extension. Almost the same as panelFronted but allows for whitelist
 * toggle.
 */

//---------- CONSTANTS ----------//

const SERVER_DOMAIN = "https://localhost:48091/";
const INITIAL_BOARD = "initBoard"

//---------- SETTUP ----------//

let authorization = undefined;

//---------- FUNCTIONS / EVENT LISTENERS ----------//

window.Twitch.ext.onAuthorized(function(auth){
    
    authorization = auth;

    $.ajax({
        url: SERVER_DOMAIN + INITIAL_BOARD,
        type: "GET",
        headers:{
            "extension-jwt": auth.token,
        },
        success: initBoard
        //TODO Define error handler
    });

    //TODO Get rid of this line
    console.log("onAuthorized fired");

});


window.Twitch.ext.onContext(function(cxt, changeArr){
    //TODO Get rid of this line
    console.log("onContext fired");
});

$(function(){

    $("#refresh").on("click", refresh);

});


/**
 * Populates board and global variables for the first time.
 *
 */
function initBoard(userTimes){

    viewers = []
    searchable = JSON.parse(userTimes);
    console.log(`${userTimes}\n`);
    console.log(searchable);

    //TODO sort searchable users into viewers array by time
    
    for (let user in searchable){
        viewers.push([user, searchable[user].time]);
    }

    viewers.sort(function(a, b){
        return a[1] - b[1];
    });

    for (let user of viewers){
        let item = $("<li>").text(`${user[0]}: ${user[1]}`);
        $("#board").append(item);
    }
}

/**
 * Displays leaderboard onto the iframe
 */
function displayLeaderboard(){

}


/**
 * Refreshes leaderboard with updated viewer times
 */
function refresh(){
    //TODO Require cooldown before clicking again
    
    if(authorization == undefined){
        console.log("Authorization undefined.");
    }

    $.ajax({
        url: SERVER_DOMAIN + INITIAL_BOARD,
        type: "GET",
        headers:{
            "extension-jwt": authorization.token,
        },
        success: initBoard
        //TODO Define error handler
    });
}
