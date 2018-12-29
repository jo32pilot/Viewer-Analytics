/**
 * @fileoverview Backend for Viewer Analytics Twitch extension. Handles API
 * calls, database queries, viewer queries, and broadcaster configurations.
 * Dependencies:
 *      - jQuery
 *      - [New Twitch API](https://dev.twitch.tv/docs/api/)
 *      - [jsrsasign](https://github.com/kjur/jsrsasign)
 */

let jwt = require("jsrsasign");

//All other constants go in config.json
const JSON_PATH = "config.json";
let json = $.getJSON(JSON_PATH);

