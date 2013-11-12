(function(){
    $(document).ready(function(){
        var webview;
        var params;
        var query = window.location.search.substring(1);
        var queryParts = query.split("&");
        params = {};
        for (var i = 0, li = queryParts.length; i < li; i++){
            var parts = queryParts[i].split("=");
            params[parts[0]] = decodeURIComponent(parts[1]);
        }

        webview = $("#appview")[0]
        if (params.user_agent != null && webview.setUserAgentOverride)
            webview.setUserAgentOverride(params.user_agent);
        webview.addEventListener('loadstop', function(e) {
            if (params.css_inject != null)
                webview.insertCSS({file:params.css_inject});
            webview.insertCSS({file:"css/inject/default.css"});
            if (params.js_inject != null)
                webview.executeScript({file:params.js_inject});
            webview.executeScript({file:"js/inject/default.js"});
        });
        webview.src=params.remote_url;
        webview.addEventListener('close', function() {
            window.close();
        });

        var appWindow = chrome.app.window.current();

        $(document).keydown(function (e){
            switch (e.keyCode){
                case 27:
                    if (appWindow.isFullscreen())
                        appWindow.restore();
                    break;
                case 122:
                    if (appWindow.isFullscreen())
                        appWindow.restore();
                    else
                        appWindow.fullscreen();
                    break;
            }

        });

        appWindow.onFullscreened.addListener(function(){
            appWindow.focus();
        });

        appWindow.onMaximized.addListener(function(){
            appWindow.fullscreen();
        });

        appWindow.onRestored.addListener(function(){
            if (appWindow.isMaximized())
                appWindow.restore();
        })

    })

})();