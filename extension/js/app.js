chrome.app.runtime.onLaunched.addListener(function(){
    chrome.app.window.create("management.html",{state:"normal",minWidth:640,minHeight:480,id:"CrCastManagement"});
});

require(["SSDPServer","WebServer","WebRequestResponder","ChromecastApp"],function(SSDPServer,WebServer,Responder,ChromecastApp){
    App = {
        httpServer: null,
        ssdpServer: null,
        serviceState: "stopped",
        useIdleScreen: true,
        runOnStart: false,
        addressList: [],
        resolveSSDPAddress: function(addressFrom){
            for (var i = 0, li = App.addressList.length; i < li; i++){
                if (App.addressList[i].regex.test(addressFrom)){
                    return App.addressList[i].address;
                }
            }
            return "0.0.0.0";
        },
        setFriendlyName: function(name){
            this.friendlyName = name;
            this.uuid = UUID.v5("com.loutsenhizer.crcast." + this.friendlyName.replace(/\s+/g, ''),"6ba7b810-9dad-11d1-80b4-00c04fd430c8");//domain namespace
        },
        startService: function(bootStart){
            App.serviceState = "starting";
            chrome.socket.getNetworkList(function(result){
                App.addressList = [];
                for (var i = 0; i < result.length; i++){
                    if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(result[i].address)){
                        App.localAddress = result[i].address
                        App.addressList.push({
                            address: result[i].address,
                            regex: new RegExp("\\b" + result[i].address.substring(0,result[i].address.lastIndexOf(".")).replace(/\./g,"\\.") + "\\.\\d{1,3}\\b")
                        });
                    }
                }
                App.httpServer = new WebServer("0.0.0.0",8008,true);
                App.ssdpServer = new SSDPServer();

                App.httpServer.addResponder(new Responder("/ssdp/device-desc.xml",["GET"],function(request){
                    var response = request.webserver.createHTTPResponse();
                    var temp = App.ssdpServer.getXMLDescription(request.headers["Host"]);
                    response.content = temp.content;
                    for (var member in temp.headers){
                        response.headers[member] = temp.headers[member];
                    }

                    request.webserver.sendResponse(request,response);
                }));

                App.httpServer.addResponder(ChromecastApp.appXMLResponder);
                App.httpServer.addResponder(ChromecastApp.activeAppResponder);
                App.httpServer.addResponder(ChromecastApp.launchAppResponder);
                App.httpServer.addResponder(ChromecastApp.appConnectionWebSocketResponder);
                App.httpServer.addResponder(ChromecastApp.systemControlResponder);
                App.httpServer.addResponder(ChromecastApp.closeAppResponder);
                App.httpServer.addResponder(ChromecastApp.systemInformationResponder);
                App.httpServer.addResponder(ChromecastApp.appReceiverWebSocketResponder);
                App.httpServer.addResponder(ChromecastApp.appConnectionResponder);
                App.httpServer.addResponder(ChromecastApp.appRemoteResponder);

                chrome.storage.local.get("officialDeviceConfig",function(s){
                    if (s.officialDeviceConfig != null){
                        ChromecastApp.loadConfiguration(JSON.parse(s.officialDeviceConfig.substring(4)));
                    }
                    $.ajax("https://clients3.google.com/cast/chromecast/device/config",{
                        dataType:"text",
                        success:function(data){
                            App.serviceState = "running";
                            App.updateConfigRequest = null;
                            chrome.storage.local.set({"officialDeviceConfig":data});
                            ChromecastApp.loadConfiguration(JSON.parse(data.substring(4)));
                            if (App.useIdleScreen && !bootStart)
                                ChromecastApp.launchApp(ChromecastApp.idleAppname);
                        },
                        error:function(){
                            App.serviceState = "running";
                            if (App.useIdleScreen && !bootStart)
                                ChromecastApp.launchApp(ChromecastApp.idleAppname);
                            App.updateConfigRequest = null;
                        }
                    });


                });
            });
        },
        stopService: function(){
            if (App.serviceState == "running"){
                if (ChromecastApp.activeApp != null)
                    ChromecastApp.activeApp.close(true);
                App.httpServer.stop();
                App.ssdpServer.stop();
                App.httpServer = null;
                App.ssdpServer = null;
                App.serviceState = "stopped";
            }
        },
        persistSettings: function(){
            chrome.storage.local.set({"settings":{
                name: App.friendlyName,
                useIdleScreen: App.useIdleScreen,
                runOnStart: App.runOnStart
            }});

        },
        loadSettings: function(){
            chrome.storage.local.get("settings",function(s){
                if (s.settings != null){
                    App.setFriendlyName(s.settings.name);
                    App.useIdleScreen = s.settings.useIdleScreen;
                    App.runOnStart = s.settings.runOnStart;
                    if (App.runOnStart){
                        App.startService(true);
                    }
                }
                else{
                    App.setFriendlyName("CR Cast");
                    App.persistSettings();
                }
            });

        }
    };


    App.setFriendlyName('CR Cast');
    App.loadSettings();

    window.addEventListener("message", function(messageEvent){
        var message = JSON.parse(messageEvent.data);
        switch (message.type){
            case "GET_STATE":
                messageEvent.source.postMessage(JSON.stringify({
                    type: "APP_STATE",
                    app_state: {
                        serviceState: App.serviceState,
                        friendlyName: App.friendlyName,
                        uuid: App.uuid,
                        useIdleScreen: App.useIdleScreen,
                        runOnStart: App.runOnStart
                    }
                }),"*");
                break;
            case "START_SERVICE":
                App.startService(false);
                break;
            case "STOP_SERVICE":
                App.stopService();
                break;
            case "SET_DISPLAY_NAME":
                App.setFriendlyName(message.name);
                App.persistSettings();
                break;
            case "SET_IDLESCREEN_ENABLED":
                App.useIdleScreen = message.use;
                App.persistSettings();
                break;
            case "SET_RUN_ON_START":
                App.runOnStart = message.run;
                App.persistSettings();
                break;
            case "LAUNCH_APP":
                if (App.serviceState == "running"){
                    if (message.idle){
                        ChromecastApp.launchApp(ChromecastApp.idleAppname);
                    }
                    else{
                        ChromecastApp.launchApp(message.name);
                    }
                }
                break;
        }

    });

});