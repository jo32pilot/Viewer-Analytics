/**
 * @fileoverview Handles frontend interaction between viewers and the
 * the extension. Just displays leaderboard in various ways as well as 
 * letting users search others and their times.
 */

//---------- CONSTANTS ----------//

const BACKEND_PATH = "";

//---------- SETTUP ----------//

const board = document.getElementById("board");
const viewers = [];

//Object for average O(1) search for user times 
//(Apparently they're implemented as hash maps)
const searchable = {};


//---------- FUNCTIONS / EVENT LISTENERS ----------//

window.Twitch.ext.onAuthorized(function(auth){
    $.ajax({
        url: BACKEND_PATH,
        type: "GET",
        headers:{
            "extension-jwt": auth.token,
        }
    });
    console.log("onAuthorized fired");
});


window.Twitch.ext.onContext(function(cxt, changeArr){
    console.log("onContext fired");
});


/**
 * Displays leaderboard onto the iframe
 */
function displayLeaderboard(){

    }
}


/**
 * Refreshes leaderboard with updated viewer times
 */
function refresh(){
    //TODO Require cooldown before clicking again
}
