
const BOARD = document.getElementById("board");
const ONE_SECOND = 1000;
let viewers = [];
//want to sort by values but rearrange viewer ordering. most likeley will
//sort into an array and hash for each time to display onto board.
let searchable = new Map();

window.Twitch.ext.onAuthorized(function(ids){
    searchable.set(ids.userId, new TimeTracker(ids.userId));
    console.log("onAuthorized fired");
});

window.Twitch.ext.onContext(function(cxt, changeArr){
    console.log("onContext fired");
});

function display(){
    //TODO change to viewers later, map will remain unsorted for O(1) search.
    for(let [keys, values] of searchable.entries()){
        let newItem = document.createElement("li");
        let newTime = document.createTextNode(keys + " " + values);
        BOARD.appendChild(newItem);
    }
}

function refresh(){

}

//will add actual documentation later
class TimeTracker{


    constructor(user){
        this.user = user;
        this.time = 0;
        this.paused = false;

        this.tracker = this.startTime();
    }

    startTime(){

        let currTimer = this;

        let tracker = setInterval(function(){
            if(!this.paused){
                currTimer.time += 1;
            }
        }, ONE_SECOND);
        
        return tracker;

    }

    //gets called when user stops viewing.
    stopTime(){
        clearInterval(this.tracker);
    }

    //gets called when user pauses stream.
    pauseTime(){
        this.paused = true;
    }

    unpauseTime(){
        this.paused = false;
    }

}

