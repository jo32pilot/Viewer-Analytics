
let modeArr = [];
let board = document.getElementById("board");

window.Twitch.ext.onContext(function(cxt, changeArr){
    modeArr.push(cxt.mode);
});

function display(){
    let newTime = document.createTextNode(modeArr);
    board.appendChild(newTime);
}
