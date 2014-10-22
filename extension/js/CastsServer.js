define(["CastsServer"],function(CastsServer){
    //note: it's recommended to run on port 8009 since that's what chromecast does
    var CastsServer = function(ip, port, retryTillSuccess){
        var that = this;
        chrome.socket.create("tcp",{},function(result){
            that.socketId = result.socketId;
            function bindPort(){
                chrome.socket.listen(that.socketId,ip,port,50,function(result){
                    if (result !== 0){
                        console.error("failed to bind tcp " + port);
                        if (retryTillSuccess){
                            console.log("retying in 5 seconds")
                            $.doTimeout(5000,function(){
                                bindPort();
                            })
                        }
                        return;
                    }
                    that.port = port;
                    that.stopped = false;
                    chrome.socket.accept(that.socketId,function(acceptInfo){
                        that._onAccept(acceptInfo);
                    });
                });
            }
            bindPort();

        });

    };

    CastsServer.prototype._onAccept = function(acceptInfo) {
        if (this.stopped)
            return;
        var that = this;

        this._readData(acceptInfo.socketId);
        chrome.socket.accept(this.socketId,function(acceptInfo){
            that._onAccept(acceptInfo);
        });
    }

    CastsServer.prototype._readData = function(socketId){
        if (this.stopped)
            return;
        var that = this;
        chrome.socket.read(socketId,function(readInfo){
            console.log(readInfo);
            that._readData;
        });
    }

    return CastsServer;

});