(function(){
    function updateInfo(){
        var req = new XMLHttpRequest();
        req.open('GET', 'http://localhost:8008/setup/eureka_info', false);
        req.send(null);
        window.postMessage(JSON.stringify({type:"EUREKA_INFO",eureka_info:JSON.parse(req.responseText)}),"*");
    }
    updateInfo();
    setInterval(updateInfo,1000);

    setInterval(function(){
        window.postMessage('{"type":"PING"}',"*");
    },100)

})();