/**
 * @fileoverview Handles frontend interaction between viewers and the
 * the extension. Just displays leaderboard in various ways as well as 
 * letting users search others and their times.
 */

//---------- CONSTANTS ----------//

const SERVER_DOMAIN = "https://localhost:48091/";
const INITIAL_BOARD = "initBoard";
const LONG_STATS = "longStats";
const SEARCH_USER = "searchUser";
const LEADERBOARD_INCREASE = 50;

//---------- SETTUP ----------//

let authorization = undefined;
let viewers = undefined;
let savedBoard = undefined;
let currentDisplay = LEADERBOARD_INCREASE;

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

$("#refresh").on("click", refresh);
$("#search").submit(name, function(ev){

    _createRequest(SEARCH_USER, displayResults, name);

});
$(window).on("popstate", function(ev){

    if(savedBoard != undefined){
        $("#leaderboard").replaceWith(savedBoard);
    }
    else{
        //log
    }
});

// Credit to https://gist.github.com/toshimaru/6102647 for this event listener
// that detects the scrolling to the bottom of a page.
$(window).on("scroll", function(){

    var scrollHeight = $(document).height();
    var scrollPosition = $(window).height() + $(window).scrollTop();
    if((scrollHeight - scrollPosition) / scrollHeight == 0){
        
        // Adds another 50 users to the leaderboard.
        for(let i = currentDisplay; i < currentDisplay + LEADERBOARD_INCREASE;
                i++){
            
            let item = $("<button/>", {
            
                text: `${i + 1}. ${viewers[i]}`,
                click: function(){
                    _createRequest(LONG_STATS, displayIndividual);
                }

            });
            
            $("leaderboard").append(item);
        }

        currentDisplay += LEADERBOARD_INCREASE;
    }
});


/**
 * Populates board and global variables for the first time.
 */
function initBoard(res){

    viewers = []

    for (let user in res){
        viewers.push([user, res[user]]);
    }

    viewers.sort(function(a, b){
        return a[1] - b[1];
    });

    
    for(let i = 0; i < currentDisplay; i++){

        let item = $("<button/>", {
        
            text: `${i + 1}. ${viewers[i]}`,
            click: function(){
                _createRequest(LONG_STATS, displayIndividual);
            }

        });
        
        $("#board").append(item);
    }
}

/**
 * Displays search results in the form of a leaderboard.
 * @param {ServerResponse} res Response payload from server containing
 *                         the closest matching usernames.
 */
function displayResults(res){
    
    savedBoard = $("#leaderboard").clone(true, true);
    history.pushState({}, "");
    $("#leaderboard").empty();
    initBoard(res);
    //TODO animate in the back button. But for now...
    const back = $("<button/>", {
        text: "back",
        click: function(){
            history.back();
        }
    });
    $("#search_div").append(back);
}

/**
 * Displays leaderboard a given person's exhaustive watch statistics.
 * @param {ServerResponse} res Response payload from server containing the 
 *                         desired statistics.
 */
function displayIndividual(res){
}


/**
 * Refreshes leaderboard with updated viewer times
 */
function refresh(){
    //TODO Require cooldown before clicking again
    
    if(authorization == undefined){
        console.log("Authorization undefined.");
    }

    _createRequest(INITIAL_BOARD, initBoard);
}

function _createRequest(path, callback, userToSearch=undefined){

    const reqHeaders = {
        "extension-jwt": authorization.token
    };
    
    if(extraHeaders != undefined){
        reqHeaders["userToSearch"] = userToSearch;
    }

    $.ajax({
        url: SERVER_DOMAIN + path,
        type: "GET",
        headers: reqHeaders
        success: callback
        //TODO define error handler
    });

}
