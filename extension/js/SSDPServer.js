define(function(){

    var UPNP_ADDRESS = '239.255.255.250';
    var UPNP_PORT = 1900;

    var SSDPServer = function(onReady){
        var that = this;
        that.socketId = null;
        that.localAddress = null;


        chrome.socket.create("udp",{},function(createInfo){
            that.socketId = createInfo.socketId;
            chrome.socket.setMulticastTimeToLive(that.socketId,20,function(result){
                chrome.socket.setMulticastLoopbackMode(that.socketId,true,function(result){
                    chrome.socket.bind(that.socketId,"0.0.0.0",UPNP_PORT,function(result){
                        chrome.socket.joinGroup(that.socketId,UPNP_ADDRESS,function(result){
                            that.running = true;
                            that._listen();
                            if (onReady != null)
                                onReady();

                        });
                    });
                })
            })

        });

    }

    SSDPServer.prototype.onReceive = function(text,address,port){
        if ((text.indexOf("urn:dial-multiscreen-org:service:dial:1") >= 0 || text.indexOf("urn:dial-multiscreen-org:device:dial:1") >= 0) && text.indexOf("M-SEARCH") >= 0){
            var urn;
            if (text.indexOf("urn:dial-multiscreen-org:service:dial:1") >= 0 ){
                var urn = "urn:dial-multiscreen-org:service:dial:1";
            }
            else{
                urn = "urn:dial-multiscreen-org:device:dial:1";
            }
            var message = "HTTP/1.1 200 OK\r\n" +
                "ST: " + urn + "\r\n"+
                "HOST: 239.255.255.250:1900\r\n"+
                "EXT:\r\n"+
                "CACHE-CONTROL: max-age=1800\r\n"+
                "LOCATION: http://"+App.resolveSSDPAddress(address)+":8008/ssdp/device-desc.xml\r\n" +
                "CONFIGID.UPNP.ORG: 7339\r\n" +
                "BOOTID.UPNP.ORG: 7339\r\n" +
                "USN: uuid:" + App.uuid + "::" + urn + "\r\n\r\n";
            chrome.socket.sendTo(this.socketId,stringToArrayBuffer(message),address,port,function(result){
            });

        }

    }

    SSDPServer.prototype.getXMLDescription = function(address){
        var response = {};
        response.content = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
                <root xmlns=\"urn:schemas-upnp-org:device-1-0\" xmlns:r=\"urn:restful-tv-org:schemas:upnp-dd\">\
                    <specVersion>\
                        <major>1</major>\
                        <minor>0</minor>\
                    </specVersion>\
                        <URLBase>http://" + address +"</URLBase>\
                    <device>\
                        <deviceType>urn:schemas-upnp-org:device:dail:1</deviceType>\
                        <friendlyName>" + App.friendlyName + "</friendlyName>\
                        <manufacturer>Google Inc.</manufacturer>\
                        <modelName>Eureka Dongle</modelName>\
                        <UDN>uuid:" + App.uuid + "</UDN>\
                        <serviceList>\
                            <service>\
                                <serviceType>urn:schemas-upnp-org:service:dail:1</serviceType>\
                                <serviceId>urn:upnp-org:serviceId:dail</serviceId>\
                                <controlURL>/ssdp/notfound</controlURL>\
                                <eventSubURL>/ssdp/notfound</eventSubURL>\
                                <SCPDURL>/ssdp/notfound</SCPDURL>\
                            </service>\
                        </serviceList>\
                    </device>\
                </root>";
        response.headers = {};
        response.headers["Content-Type"] = "application/xml";
        response.headers["Access-Control-Allow-Method"] = "GET, POST, DELETE, OPTIONS";
        response.headers["Access-Control-Expose-Headers"] = "Location";
        response.headers["Application-Url"] = "http://" + address + "/apps";
        return response;
    }

    SSDPServer.prototype._listen = function(){
        if (!this.running)
            return;
        var that = this;
        chrome.socket.recvFrom(this.socketId,1048576,function(result){
            that.onReceive(arrayBufferToString(result.data),result.address,result.port);
            that._listen();
        });
    }

    SSDPServer.prototype.stop = function(){
        this.running = false;
        chrome.socket.destroy(this.socketId);
    }

    return SSDPServer;
});