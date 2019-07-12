/**
 * @fileoverview Handles frontend interaction between viewers and the
 * the extension. Just displays leaderboard in various ways as well as 
 * letting users search others and their times.
 */

//---------- CONSTANTS ----------//

/**
 * Paths to dark mode css.
 * @const
 */
const DARK_MODE = "darkmode.css";

/**
 * Paths to light mode css.
 * @const
 */
const LIGHT_MODE = "lightmode.css";

/**
 * Color for inside of line for the line graph.
 * @const
 */
const BACKGROUND_COLOR = "rgb(100, 65, 164)";

/**
 * Color for border of line for the line graph.
 * @const
 */
const BORDER_COLOR = "rgb(100, 54, 164)";

/**
 * URL to where server is hosted.
 * @const
 */
const SERVER_DOMAIN = "https://vieweranalytics.me:443/";

/**
 * Request URLs to add to the end of the server domain.
 * @const
 */
const INITIAL_BOARD = "initBoard";
const LONG_STATS = "longStats";
const GET_PERIOD = "getPeriod";
const SEARCH_USER = "userSearch";
const TOGGLE_TRACKER = "toggleTracker";
const TOGGLE_WHITELIST = "toggleWhitelist";

/**
 * Determines if a button is active or not. If not, stop focusing on the 
 * button.
 * @const
 */
const ACTIVE = "active";


/**
 * Seconds in a minute.
 * @const
 */
const SECONDS = 60;

/**
 * Minutes in an hour.
 * @const.
 */
const MINUTES = 60;

/**
 * Number to increase how many people should appear on the leaderboard.
 * @const
 */
const LEADERBOARD_INCREASE = 50;

/**
 * Index to start looping from when pasrsing graph info.
 * @const
 */
const SKIP_ID = 2;

/**
 * Maximum number of data points to display on the graph.
 * @const
 */
const MAX_GRAPH_DISPLAY = 10;

/**
 * Minimum number of keys in graph data object to consider
 * displaying MAX_GRAPH_DISPLAY number of data points.
 * @const
 */
const REQ_KEY_ARR_LEN = 12;

/**
 * Number of milliseconds to wait before retrying request creation.
 * @const
 */
const RETRY_OFFSET = 3000;

//---------- SETTUP ----------//

/**
 * Array of arrays. Inner arrays contain usernames at [0] and their
 * respective accumulated times at [1].
 * !Array<!Array<string | int>> | undefined
 */
let viewers = undefined;

/**
 * Associative array to store people on the leaderboard who have been clicked
 * as keys and their statistics as values via DOM elements.
 * !Object<string, !jQueryObject>
 */
let clicked = undefined;

/**
 * Same as viewers array but is used as a reference to save viewers prior to a
 * search query.
 * !Array<!Array<string | int>> | undefined
 */
let viewersSaved = undefined;

/**
 * Stores people on the leaderboard who have been clicked on the list prior
 * to a search query.
 * !Object<string, !jQueryObject>
 */
let clickedSaved = undefined;

let currentClicked = undefined;     // Name of user who's button was recently 
                                    // clicked.

let name = undefined;               // Display name of user.

let authorization = undefined;      // Authorization object. Properties 
                                    // are specifed on the Twitch Extensions
                                    // reference.
                                    
let savedBoard = undefined;         // HTML to save the board so
                                    // pressing back is seamless.

let recentText = undefined;         // Recently submitted text.

let paused = true;                  // Whether or not user is paused.

let displaying = false;             // Whether or not search results are being
                                    // displayed.

let period = "session";             // Which period of time the user is looking
                                    // at

let currentDisplay = 0;             // How many people are currently being
                                    // displayed on the leaderboard.

let prevDisplay = 0;                // How many people were being displayed on
                                    // the leaderboard beofre a search.

$("#" + period).addClass(ACTIVE);

//---------- FUNCTIONS / EVENT LISTENERS ----------//

Twitch.ext.actions.requestIdShare();

// Define onAuthorized event.
window.Twitch.ext.onAuthorized(function(auth){
   
    authorization = auth;

    _createRequest(INITIAL_BOARD, initBoard, {
        "paused": paused
    });

});

// Define onContext event
window.Twitch.ext.onContext(function(cxt, changeArr){
  
    // If user is not paused, unpause tracker on the server.
    if(paused && cxt["isPaused"] == false && name != ""){
        _createRequest(TOGGLE_TRACKER, undefined, additionalArgs={
            "paused": false,
            "viewerqueriedfor": name
        });
        paused = false;
    }

    // If user is paused, pause tracker on the server.
    else if(!paused && cxt["isPaused"] == true && name != ""){
        _createRequest(TOGGLE_TRACKER, undefined, additionalArgs={
            "paused": true,
            "viewerqueriedfor": name
        });
        paused = true;
    }

    paused = cxt["isPaused"];

    // Toggle dark and light css themes.
    if(cxt["theme"] == "light"){
        $("#dark").prop("disabled", true);
        $("#light").prop("disabled", false);
        currTheme = "light"
    }
    else if(cxt["theme"] == "dark"){
        $("#light").prop("disabled", true);
        $("#dark").prop("disabled", false);
    }

});

$("#refresh").on("click", refresh);


// Define functionality when clicking on any of the tabs specifying the
// period of time to display.
$(".tabtimes").on("click", function(ev){
   
    // No need to do anything if the focused tab was clicked again.
    if(period == this.id){

        // Unless we recently searched. Then bring back old board.
        if(displaying){
            $("#back").trigger("click");
        }

        return;
    }

    if(displaying){
        $("#leaderboard").empty();
        _back();
        displaying = false;
    }

    $(".tabtimes").each(function(){

        // Unfocus currently focused button.
        if(period == this.id){
            $(this).removeClass(ACTIVE);
        }

    });

    // Focus button that was just clicked.
    $(this).addClass(ACTIVE);

    // Request for the times of the period of time clicked.
    _createRequest(GET_PERIOD, initBoard, additionalArgs={
        "period": this.id
    }),

    period = this.id;

});


// Define back button event. Bring back board before initial search.
$("#back").on("click", function(ev){

    // Hide and show the right buttons. Put back old board.
    viewers = viewersSaved;
    currentDisplay = prevDisplay;
    $("#leaderboard").empty();
    $("#leaderboard").append(savedBoard);
    clicked = clickedSaved;
    _back();
    displaying = false;

});

// Define a means to submit text input.
$("#search").keypress(function(e){
    if(e.which == 13){
        $(this).submit();
        return false;
    }
});

// Define search bar submit event.
$("#search").submit(function(ev){

    const nameQuery = $(this).val();

    // If no change to text box has been made since last submit 
    // or text is empty, do nothing.
    if(nameQuery.length == 0 || nameQuery == recentText){
        return;
    }
    recentText = nameQuery;

    _createRequest(SEARCH_USER, displayResults, additionalArgs={
        "viewerqueriedfor": nameQuery
    });

});

// Before window closes or user leaves page, send request to pause their
// tracker.
$(window).on("beforeunload", function(){

    if(name != ""){

        _createRequest(TOGGLE_TRACKER, undefined, additionalArgs={
            "paused": true,
            "viewerqueriedfor": name
        });

    }
});

// Event listener that detects the scrolling to the bottom of a page.
$("#leaderboard").scroll(function(){

    if($(this)[0].scrollHeight - $(this).scrollTop() - $(this).outerHeight() 
            < 1){
        
        // Adds another 50 users to the leaderboard.
        _initButtons();

    }
});


/**
 * Populates board and global variables for the first time.
 * @param {string} res Response payload from server containing
 *                 the accumulated times of the viewers.
 * @param {string} [undefined] status Text status of the request.
 * @param {jqXHR} [undefined] jqXHR XMLHttpRequest object to get response 
 *                            headers from.
 */
function initBoard(res, status=undefined, jqXHR=undefined){

    // Disable all buttons until finished initBoard.
    $(":button").prop("disabled", true);

    if(jqXHR != undefined){
        _setName(jqXHR.getResponseHeader("name"));
    }
    if(name == undefined){
        const popUp = $("<div/>", {
            id: "id_off"
        });
        const text = "<p>If you want to see yourself on this board, "
                    + "enable ID sharing! ID sharing just allows the extension" 
                    + "to see your display name. To enable ID sharing, click on"
                    + " the person icon at the bottom of this extension, then "
                    + "click \"Grant\".<br><br>Note: "
                    + "The streamer is not shown on the board.</p>";
        popUp.append(text);
        popUp.prepend($("<button/>", {
            text: "x",
            id: "close_pop",
            click: function(){
                popUp.remove();
            }
        }));

        $("body").append(popUp);
        _setName("");
    }

    $("#leaderboard").scrollTop(0);

    $("#leaderboard").empty();
    currentDisplay = 0;

    // Parse response string into JSON.
    res = JSON.parse(res);
    
    viewers = res["viewers"];

    if(!displaying){
        // Sort descending order by time.
        viewers.sort(function(a, b){
            return b[1] - a[1];
        });
    }

    _initButtons();

    // Re-enable buttons
    $(":button").prop("disabled", false);
    
}

/**
 * Displays search results in the form of a leaderboard.
 * @param {ServerResponse} res Response payload from server containing
 *                         the closest matching usernames.
 */
function displayResults(res){
    
    // Save #leaderboard element to put back later seamlessly.
    if(!displaying){
        if(currentClicked != undefined){
            clicked[currentClicked].slideUp();
        }
        viewersSaved = viewers;
        savedBoard = $("#leaderboard > *").detach();
        clickedSaved = clicked;
        prevDisplay = currentDisplay;
        $("#back").toggleClass("hide_button");
        $("#refresh").toggleClass("hide_button");
        displaying = true;
    }

    $("#leaderboard").empty();
    initBoard(res);
}

/**
 * Displays leaderboard a given person's exhaustive watch statistics.
 * @param {string} res Response payload from server containing the 
 *                 desired statistics.
 * @param {string} status String describing the status of the request.
 * @param {jqXHR} jqXHR XMLHttpRequest object used for reading
 *                response headers.
 */
function displayIndividual(res, status, jqXHR){

    res = JSON.parse(res);
    const longStats = res["longStats"][0];
    const graphStats = res["graphStats"][0];
    const isWhitelisted = jqXHR.getResponseHeader("whitelisted");
    const userClicked = jqXHR.getResponseHeader("viewerqueriedfor");

    // Create div to organize all the recieved data.
    const individualView = $("<div/>", {
        class: "individual_view",
    });

    const timeGraph = $("<canvas/>", {
        class: "time_graph",
    });

    individualView.append(timeGraph);

    // Format the data
    const statsFormatted = $("<div/>", {
        text: `Week: ${longStats["week"]}\n`
                + `Month: ${longStats["month"]}\n`
                + `Year: ${longStats["year"]}\n`
                + `Overall: ${longStats["all_time"]}`,
        class: "info_string"
    });

    // Show if user is whitelisted or not.
    const whitelistText = $("<div/>", {
        text: `Whitelisted: ${isWhitelisted}`,
        id: "whitelist" + userClicked
    });

    individualView.prepend(statsFormatted);
    individualView.append(whitelistText);

    // Create graph displaying user's watch habits.
    const dates = [];
    const times = [];
    const keys = Object.keys(graphStats);

    let i = SKIP_ID;

    // Only want at most MAX_GRAPH_DISPLAY number of points shown at a time.
    if(keys.length >= REQ_KEY_ARR_LEN){
        i = keys.length - MAX_GRAPH_DISPLAY;
    }

    for(; i < keys.length; ++i){
        dates.push(keys[i]);
        times.push(_secondsToMinutes(graphStats[keys[i]]));
    }
    new Chart(timeGraph, {
        
        type: "line",
        data: {
            labels: dates,
            datasets: [{
                label: "Minutes",
                backgroundColor: BACKGROUND_COLOR,
                borderColor: BORDER_COLOR,
                data: times
            }]
        },
        options: {
            responsive: true,
            maintainAspectRation: false,
        }
        
    });

    // If this user is a broadcaster, then display the whitelist button.
    if(jqXHR.getResponseHeader("broadcaster") == "true"){

        // Initialize button.
        const toggleWhitelist = $("<button/>", {
            text: "Toggle Whitelist",
            class: "list_toggle",
            click: function(){

                const headers = {
                    "viewerqueriedfor": userClicked,
                };

                _createRequest(TOGGLE_WHITELIST, function(res){
                    
                    // Display new whitelist status.
                    const newText = `Whitelisted: ${res}`;
                    $("#whitelist" + userClicked).text(newText);
                    if(clickedSaved != undefined && 
                            clickedSaved[userClicked] != undefined){
                        clickedSaved[userClicked].children(
                                "#whitelist" + userClicked).text(newText);
                    }

                }, headers);

            }

        });

        individualView.append(toggleWhitelist);

    }

    individualView.insertAfter($("#" + userClicked));
    clicked[userClicked] = individualView;
    
    // Sliding animation when viewer is clicked on.
    individualView.slideUp();
    individualView.slideDown();
}


/**
 * Refreshes leaderboard with updated viewer times
 */
function refresh(){

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

    // How much to increment currentDisplay by to know where to start
    // indexing from next call to _initButtons.
    let newCurrDisplay = 0;
    if(currentDisplay == 0){
        clicked = {};
        currentClicked = undefined;
    }

    // Display 50 more users.
    for(let i = currentDisplay; i < currentDisplay + LEADERBOARD_INCREASE
            && i < viewers.length; i++){

        // Each user is a button that opens up to show their long stats
        // when clicked.
        let item = $("<button/>", {
        
            id: `${viewers[i][0]}`,
            class: "list",
            click: function(){
                
                const user = this.id;
                const userVal = clicked[user];
                const currClickedVal = clicked[currentClicked];
                if(currentClicked != undefined){
                    currClickedVal.slideUp();
                }
                
                // Viewer's button hasn't been clicked before. Fetch stats.
                if(userVal == undefined){
    
                    _createRequest(LONG_STATS, displayIndividual, {
                        "viewerqueriedfor": this.id
                    });
                    currentClicked = user;
                }

                // Viewer's button has been clicked twice in a row. Hide stats.
                else if(user == currentClicked){
                    currentClicked = undefined;
                }

                // Viewer's button has been clicked before. Show stats.
                else{
                    userVal.slideDown();
                    currentClicked = user;
                }
            }

        });

        // Format the leaderboard text.
        let displayTime = _secondsToFormat(viewers[i][1]);
        item.html(
                `<span class='order_align'>${i + 1} ${viewers[i][0]}</span>`
                + `<span class='time_align'>${displayTime}</span>`);

        $("#leaderboard").append(item);
        newCurrDisplay++;

    }

    // Increase current display for next call.
    currentDisplay += newCurrDisplay;

}


/**
 * Factory function to create ajax requests.
 * @param {string} path Route to request being made on the server.
 * @param {!Function} [undefined] callback Callback to call on success.
 * @param {!Object<*>} [{}] additionalArgs Additional headers to add to
 *                          request if needed.
 */
function _createRequest(path, callback, additionalArgs={}){

    let tryAgain = false;
    const reqHeaders = {};
    try{
        reqHeaders["extension-jwt"] = authorization.token;
    }
    catch(err){
        // Authorization wasn't defined yet.
        tryAgain = true;
    }

    // Check for additional args.
    for(let arg in additionalArgs){
        reqHeaders[arg] = additionalArgs[arg];
    }

    const settings = {
        url: SERVER_DOMAIN + path,
        type: "GET",
        headers: reqHeaders,
    };

    // If callback exists, attach it.
    if(callback != undefined){
        settings["success"] = callback;
    }


    // Sometimes calls are made before token is set. Wait if so.
    if(tryAgain){
        setTimeout(function(){
            reqHeaders["extension-jwt"] = authorization.token;
            $.ajax(settings);
        }, RETRY_OFFSET);
    }
    else{
        $.ajax(settings);
    }

};

/** Hides and shows appropriate buttons upon removing search results. */
function _back(){
    prevDisplay = 0;
    viewersSaved = undefined;
    recentText = undefined;
    clickedSaved = undefined;
    currentClicked = undefined;
    $("#back").toggleClass("hide_button");
    $("#refresh").toggleClass("hide_button");
}

/**
 * Sets the global variable "name"
 * @param {string} username The viewer's username
 */
function _setName(username){
    if(username != undefined){
        name = username;
    }
}

/**
 * Converts seconds to minutes.
 * @param {int} seconds Amount of seconds to convert.
 * @return the number of minutes from the amount of seconds given.
 */
function _secondsToMinutes(seconds){
    return Math.floor(seconds / SECONDS);
}

/**
 * Converts seconds to hh:mm:ss format.
 * @param {int} time Amount of seconds to convert.
 * @return the converted time in the specified format.
 */
function _secondsToFormat(time){
    const seconds = time % SECONDS;
    const minutes = ((time - seconds) / SECONDS) % MINUTES;
    const hours = Math.floor((time - (minutes * MINUTES) - seconds) 
            / SECONDS / MINUTES);
    return `${hours} h ${Math.floor(minutes)} m ${Math.floor(seconds)} s`

}

