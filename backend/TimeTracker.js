/**
 * @fileoverview Defines TimeTracker object. Used to track each user's watch
 * time for any given channel.
 */

module.exports = {
    TimeTracker: TimeTracker
};

const ONE_SECOND = 1000;

/**
 * The aforementioned TimeTracker class.
 */
class TimeTracker{

    /**
     * @param {string} user Unique user id to identify who's time is being 
     *     kept.
     */
    constructor(user){
        this.user = user;
        this.time = 0;
        this.paused = false;

        this.tracker = this.startTime();
    }

    /**
     * Returns the id value returned from setInterval. Should only be used
     * to attatch id to TimeTracker object for stopTime.
     * @return {string} The id of the timer set.
     */
    startTime(){

        let currTimer = this;

        //Update time every second
        let tracker = setInterval(function(){
            if(!this.paused){
                currTimer.time += 1;
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
