/**
 * @fileoverview Defines TimeTracker object. Used to track each user's watch
 * time for any given channel.
 */

"use strict";


/**
 * I mean, I kind of feel like this is self explanitory. It's one second. Just
 * in milliseconds.
 * @const
 */
const ONE_SECOND = 1000;


/**
 * The aforementioned TimeTracker class.
 * @export
 */
class TimeTracker{

    /**
     * @param {string} user Unique user id to identify who's time is being 
     *                 kept.
     */
    constructor(user){
        this.user = user;

        // Time is total time
        this.time = 0;

        // Time not added is time not yet added to the MySQL server
        this.timeNotAdded = 0;

        // Time to add to the daily object in the node server.
        this.dailyTime = 0;
        this.paused = false;

        this.tracker = this.startTime();
        this.prevNow = Date.now();
    }

    /**
     * Returns the id value returned from setInterval. Should only be used
     * to attatch id to TimeTracker object for stopTime.
     * @return {string} The id of the timer set.
     */
    startTime(){

        let thisObj = this;

        //Update time every second
        let tracker = setInterval(function(){
            if(!thisObj.paused === true){
                let currTime = Date.now();
                let toAdd = (currTime - thisObj.prevNow) / ONE_SECOND;
                thisObj.prevNow = currTime;
                thisObj.time += toAdd;
                thisObj.timeNotAdded += toAdd;
                thisObj.dailyTime += toAdd;
            }
        }, ONE_SECOND);
        
        return tracker;

    }

    /**
     * Stops timer set by startTime. Generally gets called when user stops
     * viewing.
     */
    stopTime(){
        clearInterval(this.tracker);
    }

    /**
     * Pauses timer set by startTime. Generally gets called when user pauses 
     * stream.
     */
    pauseTime(){
        this.paused = true;
    }

    /**
     * Unpauses timer set by startTime. Gets called when user resumes stream.
     */
    unpauseTime(){
        this.paused = false;
    }


}

module.exports = {
    TimeTracker: TimeTracker
};
