chrome.app.runtime.onLaunched.addListener(function(){
    chrome.app.window.create("management.html",{state:"normal",minWidth:640,minHeight:480,id:"CrCastManagement"});
});

chrome.storage.local.remove("officialDeviceConfig");

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


                App.getCombinedRepositoryData(function(data){
                    ChromecastApp.loadConfiguration(data);
                    App.serviceState = "running";
                    if (App.useIdleScreen && !bootStart)
                        ChromecastApp.launchApp(ChromecastApp.idleAppname);
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
            chrome.storage.local.set({"repositories":App.repositories});

        },
        loadSettings: function(){
            chrome.storage.local.get(["settings","repositories"],function(s){
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
                if (s.repositories != null){
                    App.repositories = s.repositories;
                }
                else{
                    App.repositories = [];
                    App.repositories.push(makeRepositoryListing("Google Official Repository","https://clients3.google.com/cast/chromecast/device/config",true));
                    App.persistSettings();
                }
            });

        },
        getCombinedRepositoryData: function(callback){
            var result = makeEmptyRepository();

            function getRepository(i){
                if (App.repositories[i].active){
                    getRepositoryData(App.repositories[i].url,function(newData){
                        result = mergeRepositoryDatas(result,newData);
                        continueIteration(i+1);
                    })
                }
                else{
                    continueIteration(i+1);
                }
            }
            function continueIteration(i){
                if (App.repositories.length > i)
                    getRepository(i);
                else
                    callback(result);
            }
            continueIteration(0);
        }
    };

    function makeRepositoryListing(name,url,active){
        return {
            name: name,
            url: url,
            active: active
        };
    }

    function makeEmptyRepository(){
        return {
            configuration:{},
            applications: []
        }
    }

    function mergeRepositoryDatas(data1,data2){
        var result = makeEmptyRepository();
        if (data2.configuration != null && data2.configuration.idle_screen_app != null)
            result.configuration.idle_screen_app = data2.configuration.idle_screen_app;
        else if (data1.configuration.idle_screen_app != null)
            result.configuration.idle_screen_app = data1.configuration.idle_screen_app;
        for (var i = 0, li = data2.applications.length; i < li; i++){
            var app = data2.applications[i];
            var appCopy = {};
            for (var member in app){
                appCopy[member] = app[member];
            }
            result.applications.push(appCopy);
        }
        for (var i = 0, li = data1.applications.length; i < li; i++){
            var app = data2.applications[i];
            for (var j = 0, lj = data2.applications.length; j < lj; j++){
                if (data2.applications[j].app_name == app.app_name)
                    break;
            }
            if (j == data2.applications.length){
                var appCopy = {};
                for (var member in app){
                    appCopy[member] = app[member];
                }
                result.applications.push(appCopy);
            }
        }
        return result;
    }

    function getRepositoryData(url,callback){
        var hash = Sha1.hash(url,true);
        $.ajax(url,{
            dataType: "text",
            success: function(data){
                var object = {};
                object[hash] = data;
                chrome.storage.local.set(object);
                callback(parseRepositoryData(data));
            },
            error: function(data){
                chrome.storage.local.get(hash,function(s){
                    if (s[hash] == null){
                        callback(parseRepositoryData(""));
                    }
                    else{
                        callback(parseRepositoryData(s[hash]));
                    }
                });
            }
        })
    }

    function parseRepositoryData(data){
        try{
            return JSON.parse(data.substring(data.indexOf("{"),data.lastIndexOf("}") + 1));
        }
        catch (error){
            return {applicatoins:[]};
        }

    }


    App.setFriendlyName('CR Cast');
    App.loadSettings();

    window.addEventListener("message", function(messageEvent){
        var message = messageEvent.data;
        switch (message.type){
            case "GET_STATE":
                messageEvent.source.postMessage({
                    type: "APP_STATE",
                    app_state: {
                        serviceState: App.serviceState,
                        friendlyName: App.friendlyName,
                        uuid: App.uuid,
                        useIdleScreen: App.useIdleScreen,
                        runOnStart: App.runOnStart
                    }
                },"*");
                break;
            case "GET_REPOSITORY_LIST":
                messageEvent.source.postMessage({
                    type: "REPOSITORY_LIST",
                    repositories: App.repositories
                },"*");
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