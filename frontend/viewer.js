/**
 * @fileoverview Handles frontend interaction between viewers and the
 * the extension. Just displays leaderboard in various ways as well as 
 * letting users search others and their times.
 */

//---------- CONSTANTS ----------//

const SERVER_DOMAIN = "https://localhost:48091/";
const GET_NAME = "getName";
const INITIAL_BOARD = "initBoard";
const LONG_STATS = "longStats";
const SEARCH_USER = "searchUser";
const TOGGLE_TRACKER = "toggleTracker";
const TOGGLE_WHITELIST = "toggleWhitelist";
const MINUTE = 60;
const HOUR = 60;
const LEADERBOARD_INCREASE = 50;

//---------- SETTUP ----------//

let name = undefined;
let authorization = undefined;
let viewers = undefined;
let savedBoard = undefined;
let paused = false;
let currentDisplay = LEADERBOARD_INCREASE;

//---------- FUNCTIONS / EVENT LISTENERS ----------//

//TODO check if name is undefined for some functions

window.ext.actions.requestIdShare();

window.Twitch.ext.onAuthorized(function(auth){
    
    authorization = auth;

    _createRequest(GET_NAME, _setName);
    _createRequest(INITIAL_BOARD, initBoard);

    //TODO Get rid of this line
    console.log("onAuthorized fired");

});


window.Twitch.ext.onContext(function(cxt, changeArr){
    if(changeArr["isPaused"] == false){
        _createRequest(TOGGLE_TRACKER, additionalArgs={
            "paused": false
        });
    }
    else if(changeArr["isPaused"] == true){
        _createRequest(TOGGLE_TRACKER, additionalArgs={
            "paused": true
        });
    }
    console.log("onContext fired");
});

$("#refresh").on("click", refresh);

$("#search").submit(name, function(ev){

    _createRequest(SEARCH_USER, displayResults, {
        "viewerQueriedFor": name
    });

});
$(window).on("popstate", function(ev){

    if(savedBoard != undefined){
        $("#leaderboard").replaceWith(savedBoard);
    }
    else{
        //log
    }
});
$(window).on("beforeunload", function(){

    _createRequest(TOGGLE_TRACKER, addititionalArgs={
        "paused": true
    });

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
                    _createRequest(LONG_STATS, displayIndividual, {
                        "viewerQueriedFor": viewers[i]
                    });
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
                _createRequest(LONG_STATS, displayIndividual, {
                    "viewerQueriedFor": viewers[i]
                });
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
 * @param {String} status String describing the status of the request.
 * @param {XMLHttpRequest} jqXHR XMLHttpRequest object used for reading
 *                         response headers.
 */
function displayIndividual(res, status, jqXHR){

    const longStats = res["longStats"][0];
    const graphStats = res["graphStats"][0];

    //temp format
    const statsFormatted = $("<div/>", {
        text: `Week: ${longStats["week"]}\nMonth: ${longStats["month"]}\n`
                + `Year: ${longStats["year"]}\nAll Time: ${longStats[all_time]}`
        id: "info_string"
    });
    const whitelistText = $("<div/>", {
        text: "Whitelisted: "
        id: "whitelist"
    });
    $("#individual_view").append(statsFormatted);

    const ctx = $("#time_graph");
    const dates = [];
    const times = [];
    for(let date in graphStats){
        labels.push(date);
        dataPoints.push(_secondsToHours(graphStats[date]));
    }
    new Chart(ctx, {
        
        type: "line",
        data: {
            labels: dates,
            datasets: {
                backgroundColor: "rgb(100, 65, 164)",
                borderColor: "rgb(100, 65, 164)",
                data: times
            }],
        },
        options: {}
        
    });

    if(jqXHR.getRequestHeader("broadcaster") == true){

        const toggleWhitelist = $("<button/>", {
            text: "Toggle Whitelist"
            click: function(){
                const userToToggle = jqXJR.getRequestHeader("viewerQueriedFor");
                _createRequest(TOGGLE_WHITELIST, function(){
                
                const isWhitelisted = jqXJR.getRequestHeader("whitelisted");
                $("#whitelist").text(`Whitelisted: ${}`);

                }, {"viewerQueriedFor": userToToggle});
            }

        });
    }

     $("#individual_view").toggleSlide();
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

function _createRequest(path, callback=undefined, additionalArgs={}){

    const reqHeaders = {
        "extension-jwt": authorization.token
    };
    for(let arg in additionalArgs){
        reqHeaders[arg] = additionalArgs[arg];
    }

    //TODO define error handler
    const settings = {
        url: SERVER_DOMAIN + path,
        type: "GET",
        headers: reqHeaders
    };
    if(callback != undefined){
        settings["success"] = callback;
    }

    $.ajax(settings);

};

/**
 * Sets the global variable "name"
 * @param {String} username The viewer's username
 */
function _setName(username){
    name = username;
}

/**
 * Converts seconds to hours.
 * @param {Int} seconds Amount of seconds to convert.
 * @return The number of hours from the amount of seconds given.
 */
function _secondsToHours(seconds){
    return seconds / MINUTE / HOUR;
}
