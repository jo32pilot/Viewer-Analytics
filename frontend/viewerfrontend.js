/**
 * @fileoverview Handles frontend interaction between viewers and the
 * the extension. Just displays leaderboard in various ways as well as 
 * letting users search others and their times.
 */

//---------- CONSTANTS ----------//

const SERVER_DOMAIN = "https://localhost:48091/";
const AUTH_TITLE = "extension-jwt";
const INITIAL_BOARD = "initBoard"

//---------- SETTUP ----------//

//maybe keep multiple arrays sorted different ways so we don't have to
//sort every time?
const viewers = [];

// Object for average O(1) search for user times 
// (Apparently they're implemented as hash maps)
// Do not sort this into itself to put on the 
// board. The whole point is to keep search O(1).
var searchable = {};


//---------- FUNCTIONS / EVENT LISTENERS ----------//

window.Twitch.ext.onAuthorized(function(auth){
    $.ajax({
        url: SERVER_DOMAIN + INITIAL_BOARD,
        type: "GET",
        headers:{
            AUTH_TITLE: auth.token,
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

    $("#refresh").on("click"), refresh);

});


/**
 * Populates board and global variables for the first time.
 *
 */
function initBoard(userTimes){

    searchable = JSON.parse(userTimes);

    //TODO sort searchable users into viewers array by time
    
    for (let user in searchable){
        viewers.push([user, searchable[user]]);
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
}
