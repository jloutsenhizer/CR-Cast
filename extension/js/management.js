$(document).ready(function(){

    var app_state = {};

    var sendMessage = function(messsage){};


    var serviceStateMessage = $("#serviceState");
    var toggleService = $("#toggleService");
    var submitDisplayName = $("#submitDisplayName");
    var displayNameEntry = $("#displayName");
    var useIdleScreen = $("#useIdleScreen");
    var launchIdleScreen = $("#launchIdleScreen");
    var runOnStart = $("#runOnStart");
    var oldRunOnStart = null;
    var oldState = null;
    var oldName = null;
    var oldUseIdleScreen = null;
    toggleService.click(function(){
        if (toggleService.is(":disabled"))
            return;
        if (app_state.serviceState == "stopped"){
            toggleService.attr('disabled','disabled');
            sendMessage({type:"START_SERVICE"});
        }
        else if (app_state.serviceState == "running"){
            toggleService.attr('disabled','disabled');
            sendMessage({type:"STOP_SERVICE"});
        }
    });

    submitDisplayName.click(function(){
        if (submitDisplayName.is(":disabled"))
            return;
        if (displayNameEntry.val() != oldName){
            submitDisplayName.attr("disabled","disabled");
            displayNameEntry.attr("disabled","disabled")
            sendMessage({
                type:"SET_DISPLAY_NAME",
                name: displayNameEntry.val()
            });
        }

    });

    useIdleScreen.click(function(){
        if (useIdleScreen.is(":disabled"))
            return;
        useIdleScreen.attr("disabled","disabled");
        sendMessage({
            type: "SET_IDLESCREEN_ENABLED",
            use: useIdleScreen[0].checked
        });
    });

    launchIdleScreen.click(function(){
        if (launchIdleScreen.is(":disabled"))
            return;
        sendMessage({
            type: "LAUNCH_APP",
            idle: true
        })
    });

    runOnStart.click(function(){
        if (runOnStart.is(":disabled"))
            return;
        runOnStart.attr("disabled","disabled");
        sendMessage({
            type:"SET_RUN_ON_START",
            run: runOnStart[0].checked
        })
    })

    window.addEventListener("message", function(messageEvent){
        var message = JSON.parse(messageEvent.data);
        switch (message.type){
            case "APP_STATE":
                app_state = message.app_state;
                if (oldState != app_state.serviceState){
                    oldState = app_state.serviceState;
                    switch (app_state.serviceState){
                        case "stopped":
                        case "running":
                            toggleService.removeAttr("disabled");
                            break;
                    }
                    serviceStateMessage.text(app_state.serviceState);
                    switch (app_state.serviceState){
                        case "stopped":
                            toggleService.text("Start CR Cast");
                            break;
                        case "starting":
                        case "running":
                            toggleService.text("Stop CR Cast");
                            break;
                    }
                    if (app_state.serviceState != "running"){
                        launchIdleScreen.attr("disabled","disabled");
                    }
                    else{
                        launchIdleScreen.removeAttr("disabled");
                    }
                }
                if (oldName != app_state.friendlyName){
                    oldName = app_state.friendlyName;
                    displayNameEntry.val(app_state.friendlyName);
                    submitDisplayName.removeAttr("disabled");
                    displayNameEntry.removeAttr("disabled");
                }
                if (oldUseIdleScreen != app_state.useIdleScreen){
                    oldUseIdleScreen = app_state.useIdleScreen;
                    useIdleScreen.removeAttr("disabled");
                    useIdleScreen[0].checked = app_state.useIdleScreen;
                }
                if (oldRunOnStart != app_state.runOnStart){
                    oldRunOnStart = app_state.runOnStart;
                    runOnStart.removeAttr("disabled");
                    runOnStart[0].checked = app_state.runOnStart;
                }
                break;
        }
    });



    chrome.runtime.getBackgroundPage(function(backgroundWindow){
        sendMessage = function(message){
            backgroundWindow.postMessage(JSON.stringify(message),"*");
        }
        var getStateMessage = {
            type: "GET_STATE"
        };
        sendMessage(getStateMessage);
        $.doTimeout(50,function(){//setup state polling
            sendMessage(getStateMessage);
            return true;
        })

    });
});

