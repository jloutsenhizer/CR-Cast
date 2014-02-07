define(["WebRequestResponder","WebSocket"],function(Responder,WebSocket){

    var canSupportYoutube = true || document.createElement("webview").setUserAgentOverride != null;

    var ChromecastApp = function(name,url,options){
        if (typeof name == "object"){
            options = name;
            name = options.app_name;
            url = options.url;
        }
        if (options == null) options = {};
        this.app_name = name;
        this.url = url;
        if (this.url != null && this.url.indexOf("chrome://home") == 0){
            var query = this.url.substring(this.url.indexOf("?") + 1);
            var queryParts = query.split("&");
            for (var i = 0, li = queryParts.length; i < li; i++){
                var parts = queryParts[i].split("=");
                if (parts[0] == "remote_url")
                    this.url = decodeURIComponent(parts[1]);
            }
        }
        this.use_channel = options.use_chanel != null ? options.use_channel : false;
        this.allow_empty_post_data = options.allow_empty_post_data != null ? options.allow_empty_post_data : false;
        this.allow_restart = options.allow_restart != null ? options.allow_restart : false;
        this.external = options.external != null ? options.external : false;
        this.window = null;
        this.state = "stopped";
        this.remotes = [];
        this.receivers = [];
        this.channels = [];
        this.launchNum = 0;
        this.remoteId = 0;
        this.receiverId = 0;
        this.pingInterval = 0;
        if (this.external){
            console.error("Can't support external apps! Didn't load " + this.app_name);
            return;
        }
        if (this.app_name == "YouTube" && !canSupportYoutube){
            console.error("API needed for YouTube to work is missing! Didn't load " + this.app_name);
            return;
        }
        if (ChromecastApp.apps[this.app_name] != null){
            console.error("Already have app by name " + this.app_name);
            return;
        }
        ChromecastApp.apps[this.app_name] = this;


    };

    var appLaunchCount = 1;

    var platformVolume = 1;
    var platformMute = false;

    var appLaunchMode = "inherit";

    var oldAppMode = "fullscreen";
    var oldBounds = null;

    chrome.storage.local.get("oldAppState",function(s){
        if (s.oldAppState){
            oldAppMode = s.oldAppState.mode;
            oldBounds = s.oldAppState.bounds;
        }
    });

    var userAgent = "Mozilla/5.0 (CrKey armv7l 1.3.14651) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.0 Safari/537.36";

    ChromecastApp.prototype.launch = function(postData,onLaunched){
        if (postData == null) postData = "";
        if (onLaunched == null) onLaunched = function(){}
        if (ChromecastApp.activeApp != this){
            if (ChromecastApp.activeApp != null){
                ChromecastApp.activeApp.close(true);
            }
            var that = this;
            chrome.app.window.create('appview.html?remote_url=' + encodeURIComponent(this.url.replace(/\${POST_DATA}/g,postData).replace(/\${URL_ENCODED_POST_DATA}/g,postData))
                + "&css_inject=" + encodeURIComponent("css/inject/" + this.app_name + ".css")
                + "&js_inject=" + encodeURIComponent("js/inject/" + this.app_name + ".js")
                + "&user_agent=" + encodeURIComponent(userAgent),{state:appLaunchMode == "inherit" ? oldAppMode : appLaunchMode, bounds:oldBounds},function(window){
                that.window = window;
                ChromecastApp.activeApp = that;
                that.state = "running";
                onLaunched();

                that.window.onClosed.addListener(function(){
                    if (ChromecastApp.activeApp == that)
                        that.close(!App.useIdleScreen);
                });
                that.window.onMinimized.addListener(function(){
                    oldAppMode = "minimized";
                    chrome.storage.local.set({"oldAppState":{mode:oldAppMode,bounds:oldBounds}});
                });
                that.window.onRestored.addListener(function(){
                    oldAppMode = "normal";
                    chrome.storage.local.set({"oldAppState":{mode:oldAppMode,bounds:oldBounds}});
                });
                that.window.onFullscreened.addListener(function(){
                    oldAppMode = "fullscreen";
                    chrome.storage.local.set({"oldAppState":{mode:oldAppMode,bounds:oldBounds}});
                });

                function updateBounds(){
                    if (!(that.window.isFullscreen() || that.window.isMinimized() || that.window.isMaximized())){
                        oldBounds = that.window.getBounds();
                        chrome.storage.local.set({"oldAppState":{mode:oldAppMode,bounds:oldBounds}});
                    }

                }
                updateBounds();

                that.window.onBoundsChanged.addListener(function(){
                    updateBounds();
                })
            });


        }
        else{
            onLaunched();
            if (!ChromecastApp.activeApp.window.isMinimized())
                ChromecastApp.activeApp.window.focus();
        }


    }

    ChromecastApp.prototype.close = function(noLaunchDefault){
        if (noLaunchDefault == null) noLaunchDefault = false;
        if (ChromecastApp.activeApp == this){
            ChromecastApp.activeApp = null;
        }
        this.window.close();
        this.window = null;
        if (this.webConnectionSocket != null){
            this.webConnectionSocket.close();
            this.webConnectionSocket = null;
            this.protocols = null;
            this.state = "stopped";
        }
        for (var i = 0, li = this.channels.length; i < li; i++){
            var channel = this.channels[i];
            for (var j = 0, lj = channel.remotes.length; j < lj; j++){
                if (channel.remotes[j].socket != null)
                    channel.remotes[j].socket.close();
            }
            for (var j = 0, lj = channel.receivers.length; j < lj; j++){
                if (channel.receivers[j].socket != null)
                    channel.receivers[j].socket.close();
            }
        }
        this.channels = [];
        this.remoteId = 0;
        this.receiverId = 0;
        if (!noLaunchDefault && this.app_name != ChromecastApp.idleAppname){
            ChromecastApp.launchApp(ChromecastApp.idleAppname);
        }
    }

    ChromecastApp.prototype.xmlRequest = function(request){
        var response = request.webserver.createHTTPResponse();
        response.setCode(200);
        response.content = '<?xml version="1.0" encoding="UTF-8"?>\r\n'
        response.content += '<service xmlns="urn:dial-multiscreen-org:schemas:dial">\r\n';
        response.content += '  <name>' + this.app_name + '</name>\r\n';
        response.content += '  <options allowStop="true"/>\r\n';

        if (this.state == "running"){

            response.content += "  <servicedata xmlns='urn:chrome.google.com:cast'>\r\n";
            response.content += "    <connectionSvcURL>http://" + request.headers["Host"]  + "/connection/" + this.app_name + "</connectionSvcURL>\r\n";
            if (this.protocols != null){
                response.content += "    <protocols>\r\n";
                for (var i = 0, li = this.protocols.length; i < li; i++){
                    response.content += "      <protocol>" + this.protocols[i] + "</protocol>\r\n"
                }
                response.content += "    </protocols>\r\n";
            }
            response.content += "  </servicedata>\r\n"
        }
        response.content += '  <state>' + this.state + '</state>\r\n';
        if (this.state == "running"){
            response.content += '  <activity-status xmlns="urn:chrome.google.com:cast">\r\n';
            response.content += "    <description>" + this.app_name + " Receiver</description>\r\n";
            response.content += "  </activity-status>\r\n";
            response.content += "  <link rel='run' href='web-" + this.launchNum + "'/>\r\n";
        }
        response.content += '</service>\r\n' ;
        response.headers["Content-Type"] = "application/xml";
        response.headers["Cache-Control"] = "no-cache, must-revalidate, no-store";
        response.headers["Access-Control-Allow-Method"] = "GET, POST, DELETE, OPTIONS";
        response.headers["Access-Control-Expose-Headers"] = "Location";
        request.webserver.sendResponse(request,response);
    }

    ChromecastApp.prototype.launchRequest = function(request){
        var that = this;
        this.launch(request.postData,function(){
            function waitForRunning(){
                if (that.state != "running"){
                    $.doTimeout(10,function(){
                        waitForRunning();
                    });
                    return;
                }
                var response = request.webserver.createHTTPResponse();
                response.setCode(201);
                response.headers["Location"] = "http://" + request.headers["Host"] + "/apps/" + that.app_name + "/web-" + that.launchNum;
                response.headers["Access-Control-Allow-Method"] = "GET, POST, DELETE, OPTIONS";
                response.headers["Access-Control-Allow-Origin"] = request.headers["Host"];
                response.headers["Access-Control-Expose-Headers"] = "Location";
                response.generateHeaders();
                request.webserver.sendResponse(request,response);
            }
            waitForRunning();
        });

    }

    ChromecastApp.prototype.getChannel = function (channelNum){
        for (var i = 0, li = this.channels.length; i < li; i++){
            if (this.channels[i].num == channelNum){
                return this.channels[i];
            }
        }
        var newChannel = {num:channelNum,receivers:[],remotes:[]};
        this.channels.push(newChannel);
        return newChannel;
    }

    ChromecastApp.prototype.createRemoteChannel = function(request){
        var data = JSON.parse(request.postData);
        var channel = this.getChannel(data.channel);
        var that = this;
        var newRemote = {id: this.remoteId++, socket: null,onReady: function(){
            var response = request.webserver.createHTTPResponse();
            response.headers["Content-Type"] = ("application/json");
            response.content = JSON.stringify({
                pingInterval: that.pingInterval,
                URL: "ws://" + request.headers["Host"] + "/session/" + that.app_name + "?" + newRemote.id
            });
            request.webserver.sendResponse(request,response);
            newRemote.onReady = null;
        }};
        channel.remotes.push(newRemote);
        if (channel.remotes.length == 1){
            if (channel.receivers.length > 0){
                newRemote.onReady();
            }
            else{
                var response = {};
                response.type = "CHANNELREQUEST";
                response.requestId = data.channel;
                this.webConnectionSocket.sendFrame(JSON.stringify(response));
            }
        }
        else{
            newRemote.onReady();
        }

    }

    ChromecastApp.prototype.setupRemoteChannel = function(request){
        var index;
        for (index in request.queryParams);
        var remote = null;
        var channel;
        for (var i = 0, li = this.channels.length; i < li && remote == null; i++){
            channel = this.channels[i];
            for (var j = 0, lj = channel.remotes.length; j < lj && remote == null; j++){
                if (channel.remotes[j].id == index)
                    remote = channel.remotes[j];
            }
        }
        if (remote == null && remote.socket == null){
            var response = request.weserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            return;
        }
        var that = this;
        new WebSocket(request,function(socket){
            remote.socket = socket;
        }, function(socket,data){
            for (var i = 0, li = channel.receivers.length; i < li; i++){
                if (channel.receivers[i].socket != null)
                    channel.receivers[i].socket.sendFrame(data);
            }
        }, function (socket){
            remote.socket = null;
        })
    }

    ChromecastApp.prototype.setupWebSocket = function(request){
        if (this.webConnectionSocket != null){
            this.webConnectionSocket.close(true);
        }
        var that = this;
        new WebSocket(request,function(){

        },function(socket,data){
            if (that != ChromecastApp.activeApp){
                socket.close();
            }
            data = JSON.parse(data);
            switch (data.type){
                case "REGISTER":
                    if (data.name != that.app_name){
                        console.error("Some app tried to register when different app was running!");
                        break;
                    }
                    that.launchNum = appLaunchCount;
                    that.protocols = data.protocols;
                    that.webConnectionSocket = socket;
                    that.pingInterval = data.pingInterval

                    //create channel for chromecast to communicate on
                    var response = {};
                    response.type = "CHANNELREQUEST";
                    response.requestId = data.eventChannel;//channel 0
                    socket.sendFrame(JSON.stringify(response));
                    break;
                case "CHANNELRESPONSE":
                    var channel = that.getChannel(data.requestId);
                    channel.receivers.push({id:that.receiverId,socket:null});
                    var response = {};
                    response.type = "NEWCHANNEL";
                    response.requestId = that.receivers.length;
                    response.URL = "ws://" + request.headers["Host"] + "/receiver/" + that.app_name + "?" + that.receiverId++;
                    socket.sendFrame(JSON.stringify(response));
                    for (var i = 0; i < channel.remotes.length; i++){
                        if (channel.remotes[i].onReady != null)
                            channel.remotes[i].onReady();
                    }
                    break;
                default:
                    console.log("unknown message received from webpage")
                    console.log(data);
            }

        },function(){
            that.webConnectionSocket = null;
            that.protocols = null;
            that.state = "stopped";
        });

    }

    ChromecastApp.prototype.setupReceiverWebSocket = function(request){
        var index;
        for (index in request.queryParams);
        var that = this;
        var receiver = null;
        var channel;
        for (var i = 0, li = this.channels.length; i < li && receiver == null; i++){
            channel = this.channels[i];
            for (var j = 0, lj = channel.receivers.length; j < lj && receiver == null; j++){
                if (channel.receivers[j].id == index)
                    receiver = channel.receivers[j];
            }
        }
        new WebSocket(request,function(socket){
            receiver.socket = socket;
        }, function(socket,frameData){
            var data = JSON.parse(frameData);
            var protocol = data[0];
            var protoData = data[1];
            if (protocol == "cm"){
                switch (protoData.type){
                    case "ping":
                        socket.sendFrame(JSON.stringify(["cm",{type:"pong"}]));
                        break;
                    default:
                        console.error("unsupported cm type: ");
                        console.error(data);
                        break;
                }
            }
            for (var i = 0, li = channel.remotes.length; i < li; i++){
                if (channel.remotes[i].socket != null)
                    channel.remotes[i].socket.sendFrame(frameData);
            }

        }, function(socket){
            receiver.socket = null;
        })

    }

    ChromecastApp.apps = {};
    ChromecastApp.idleAppname = null;



    ChromecastApp.loadConfiguration = function(config){
        ChromecastApp.apps = {};
        if (ChromecastApp.activeApp != null)
            ChromecastApp.activeApp.close(true);
        ChromecastApp.idleAppname = config.configuration.idle_screen_app;
        for (var i = 0, li = config.applications.length; i < li; i++){
            new ChromecastApp(config.applications[i]);
        }

    }

    ChromecastApp.appXMLResponder = new Responder(/\/apps\/[^\/]+/,["GET"],function(request){
        var appName = request.path.substring("/apps/".length);
        var requestedApp = ChromecastApp.apps[appName];
        if (requestedApp == null){
            var response = request.webserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            console.log("No app configured with name: " + appName);
        }
        else{
            requestedApp.xmlRequest(request);
        }
    });

    ChromecastApp.activeAppResponder = new Responder(/\/apps\/?/,["GET"],function(request){
        var response = request.webserver.createHTTPResponse();
        if (ChromecastApp.activeApp != null){
            response.setCode("302");
            response.headers["Location"] = "http://" + request.headers["Host"] + "/apps/" + ChromecastApp.activeApp.app_name;
        }
        else{
            response.setCode("204");
        }

        request.webserver.sendResponse(request,response);

    });

    ChromecastApp.launchAppResponder = new Responder(/\/apps\/[^\/]+/,["POST"],function(request){
        var appName = request.path.substring("/apps/".length);
        var requestedApp = ChromecastApp.apps[appName];
        if (requestedApp == null){
            var response = request.webserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            console.log("No app configured with name: " + appName);
        }
        else{
            requestedApp.launchRequest(request);
        }
    });

    ChromecastApp.closeAppResponder = new Responder(/\/apps\/[^\/]+\/web\-[0-9]+/,["DELETE"],function(request){
        var appName = request.path.substring("/apps/".length);
        var appName = appName.substring(0,appName.indexOf("/"));
        var requestedApp = ChromecastApp.apps[appName];
        if (requestedApp == null || ChromecastApp.activeApp != requestedApp){
            var response = request.webserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            if (requestedApp == null)
                console.log("No app configured with name: " + appName);
            else
                console.log("Tried to close " + appName + ", but it wasn't running");
        }
        else{
            requestedApp.close(!App.useIdleScreen);
            requestedApp.xmlRequest(request);
        }
    });

    ChromecastApp.appConnectionWebSocketResponder = new Responder("/connection",["GET"],function(request){
        if (WebSocket.isWebSocketHandshakeRequest(request)){
            ChromecastApp.activeApp.setupWebSocket(request);
        }
        else{
            console.log('Nonchannel request to /connection made');
            var response = request.createHTTPResponse();
            response.setCode("404");
            request.sendResponse(request,response);
        }
    });

    ChromecastApp.appConnectionResponder = new Responder(/\/connection\/[^\/]+/,["POST"],function(request){
        var appName = request.path.substring("/connection/".length);
        var requestedApp = ChromecastApp.apps[appName];
        if (requestedApp == null || ChromecastApp.activeApp != requestedApp){
            var response = request.webserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            if (requestedApp == null)
                console.log("No app configured with name: " + appName);
            else
                console.log("Tried to create remote channel for " + appName + ", but it wasn't running");
        }
        else{
            requestedApp.createRemoteChannel(request);
        }
    });

    ChromecastApp.appRemoteResponder = new Responder(/\/session\/[^/]+/,["GET"],function(request){
        var appName = request.path.substring("/session/".length);
        var requestedApp = ChromecastApp.apps[appName];
        if (requestedApp == null || ChromecastApp.activeApp != requestedApp || !WebSocket.isWebSocketHandshakeRequest(request)){
            var response = request.webserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            if (requestedApp == null)
                console.log("No app configured with name: " + appName);
            else
                console.log("Tried to create remote channel for " + appName + ", but it wasn't running");

        }
        else{
            requestedApp.setupRemoteChannel(request);
        }

    });

    ChromecastApp.appReceiverWebSocketResponder = new Responder(/\/receiver\/[^\/]+/,["GET"],function(request){
        var appName = request.path.substring("/receiver/".length);
        var requestedApp = ChromecastApp.apps[appName];
        if (requestedApp == null || ChromecastApp.activeApp != requestedApp || !WebSocket.isWebSocketHandshakeRequest(request)){
            var response = request.webserver.createHTTPResponse();
            response.setCode(404);
            request.webserver.sendResponse(request,response);
            if (requestedApp == null)
                console.log("No app configured with name: " + appName);
            else
                console.log("Tried to get receiver channel for " + appName + ", but it wasn't running");
        }
        else{
            requestedApp.setupReceiverWebSocket(request);
        }

    });

    ChromecastApp.systemControlResponder = new Responder("/system/control",["GET"],function(request){
        if (WebSocket.isWebSocketHandshakeRequest(request)){
            new WebSocket(request,function(socket){
            },function(socket,data){
                var command = JSON.parse(data);
                switch (command.type){
                    case "GET_VOLUME":
                        var response = {};
                        response.success = true;
                        response.request_type = command.type;
                        response.level = platformVolume;
                        socket.sendFrame(JSON.stringify(response));
                        break;
                    case "GET_MUTED":
                        var response = {};
                        response.success = true;
                        response.request_type = command.type;
                        response.muted = platformMute;
                        socket.sendFrame(JSON.stringify(response));
                        break;
                    case "SET_VOLUME":
                        platformVolume = command.level;
                        console.warn("volume modification not supported");
                        break;
                    case "SET_MUTED":
                        platformMute = true;
                        console.warn("volume modification not supported");
                        break;
                    default:
                        console.error("unhandled system command received");
                        console.error(command);
                }
            }, function(){
            });
        }
        else{
            console.log('Nonchannel request to /system/control made');
            var response = request.createHTTPResponse();
            response.setCode("404");
            request.sendResponse(request,response);
        }
    });

    ChromecastApp.systemInformationResponder = new Responder("/setup/eureka_info",["GET"],function(request){
        var response = request.webserver.createHTTPResponse();
        response.setCode(200);
        response.headers["Content-Type"] = "application/json";
        response.headers["Cache-Control"] = "no-cache";
        response.headers["Access-Control-Allow-Origin"] = "*";
        var eureka_info = {
            release_track: "stable-channel",
            name: App.friendlyName,
            wpa_configured: true,
            timezone: jstz.determine().name(),
            signal_level: 0
        }

        response.content = JSON.stringify(eureka_info);
        request.webserver.sendResponse(request,response);

    });
    ChromecastApp.activeApp = null;

    ChromecastApp.launchApp = function(appName){
        ChromecastApp.apps[appName].launch();
    }

    return ChromecastApp

});