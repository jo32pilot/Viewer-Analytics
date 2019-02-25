/**
 * @fileoverview Handles frontend interaction between viewers and the
 * the extension. Just displays leaderboard in various ways as well as 
 * letting users search others and their times.
 */

//---------- CONSTANTS ----------//

const DARK_MODE = "darkmode.css";
const LIGHT_MODE = "lightmode.css";
const SERVER_DOMAIN = "https://localhost:48091/";
const INITIAL_BOARD = "initBoard";
const LONG_STATS = "longStats";
const GET_PERIOD = "getPeriod";
const SEARCH_USER = "searchUser";
const TOGGLE_TRACKER = "toggleTracker";
const TOGGLE_WHITELIST = "toggleWhitelist";
const ACTIVE = "active";
const SECONDS = 60;
const MINUTE = 60;
const LEADERBOARD_INCREASE = 50;

//---------- SETTUP ----------//

let name = undefined;
let authorization = undefined;
let viewers = undefined;
let savedBoard = undefined;
let paused = false;
let period = "session";
let currentDisplay = 0;
$("#" + period).addClass(ACTIVE);

//---------- FUNCTIONS / EVENT LISTENERS ----------//

//TODO check if name is undefined for some functions

window.Twitch.ext.actions.requestIdShare();

window.Twitch.ext.onAuthorized(function(auth){
    
    authorization = auth;

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
    if(changeArr["theme"] == "light"){
        $("#css").attr("href", LIGHT_MODE);
    }
    else if(changeArr["theme"] == "dark"){
        $("#css").attr("href", DARK_MODE);
    }
    console.log("onContext fired");
});

$("#refresh").on("click", refresh);

$(".tabtimes").on("click", function(ev){

    $(".tabtimes").each(function(){

        if(period == this.id){
            $(this).removeClass(ACTIVE);
        }

    });

    $(this).addClass(ACTIVE);

    _createRequest(GET_PERIOD, initBoard, additionalArgs={
        "period": this.id
    }),

    period = this.id;
});

$("#search").submit(nameQuery, function(ev){

    _createRequest(SEARCH_USER, displayResults, additionalArgs={
        "viewerQueriedFor": nameQuery
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
        _initButtons();

    }
});


/**
 * Populates board and global variables for the first time.
 * @param {ServerResponse} res Response payload from server containing
 *                         the accumulated times of the viewers.
 */
function initBoard(res, status, jqXHR){

    _setName(jqXHR.getRequestHeader("name"));
    $("#leaderboard").empty();
    currentDisplay = 0;
    viewers = []

    res = JSON.parse(res);

    for (let user in res){
        viewers.push([user, res[user].time]);
    }

    viewers.sort(function(a, b){
        return a[1] - b[1];
    });

    _initButtons();
    
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
    const back = $("<button/>", {
        id: "leave_search",
        text: "back",
        click: function(){
            $(this).addClass("hide_button");
            $("#refresh").removeClass("hide_button");
            $("#search").removeClass("search_bar_move");
            history.back();
        }
    });
    back.addClass("search_div_buttons");
    $("#refresh").addClass("hide_button");
    $("#search").addClass("search_bar_move");
    $("#search_div").prepend(back);
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

    res = JSON.parse(res);
    const longStats = res["longStats"][0];
    const graphStats = res["graphStats"][0];
    const isWhitelisted = jqXJR.getRequestHeader("whitelisted");

    //temp format
    const statsFormatted = $("<div/>", {
        text: `Week: ${longStats["week"]}\nMonth: ${longStats["month"]}\n`
                + `Year: ${longStats["year"]}\nOverall: ${longStats[all_time]}`,
        id: "info_string"
    });
    const whitelistText = $("<div/>", {
        text: `Whitelisted: ${isWhitelisted}`,
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
            },
        },
        options: {}
        
    });

    if(jqXHR.getRequestHeader("broadcaster") == true){

        const toggleWhitelist = $("<button/>", {
            text: "Toggle Whitelist",
            click: function(){
                const userToToggle = jqXJR.getRequestHeader("viewerQueriedFor");
                _createRequest(TOGGLE_WHITELIST, function(res){
                
                    $("#whitelist").text(`Whitelisted: ${res}`);

                }, {"viewerQueriedFor": userToToggle});
            }

        });

        $("#individual_view").append(toggleWhitelist);

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

    _createRequest(GET_PERIOD, initBoard, additionalArgs={
        "period": period
    });
}

/**
 * Initializes user list as list of buttons and displays them.
 */
function _initButtons(){

    for(let i = currentDisplay; i < currentDisplay + LEADERBOARD_INCREASE; 
            i++){

        let item = $("<button/>", {
        
            id: `${viewers[i][0]}`,
            cls: "list",
            click: function(){
                _createRequest(LONG_STATS, displayIndividual, {
                    "viewerQueriedFor": viewers[i][0]
                });
            }

        });

        let displayTime = _secondsToFormat(viewers[i][1]);
        $(`#${viewers[i][0]}`).html(`<span class='order_align'>${i + 1}  `
                + `${viewers[i][0]}</span><span class='time_align'>`
                + `${displayTime}</span>`);

        $("#leaderboard").append(item);

    }

    currentDisplay += LEADERBOARD_INCREASE;

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
 * @return the number of hours from the amount of seconds given.
 */
function _secondsToHours(seconds){
    return seconds / SECONDS / MINUTES;
}

/**
 * Converts seconds to hh:mm:ss format.
 * @param {Int} time Amount of seconds to convert.
 * @return the converted time in the specified format.
 */
function _secondsToFormat(time){
    const seconds = time % SECONDS;
    const minutes = ((time - seconds) / SECONDS) % MINUTES;
    const hours = (time - (minutes * MINUTES) - seconds) / SECONDS / MINUTES;
    return `${hours}:${minutes}:${seconds}`

}
