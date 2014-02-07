define(function(){

    var UPNP_ADDRESS = '239.255.255.250';
    var UPNP_PORT = 1900;

    var SSDPServer = function(onReady){
        var that = this;
        that.socketId = null;


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
    
    function generateSSDPResponse(address,ST){
        return "HTTP/1.1 200 OK\r\n" +
            "CACHE-CONTROL: max-age=1800\r\n"+
            "DATE: " + new Date().toUTCString() + "\r\n" +
            "EXT:\r\n" +
            "LOCATION: http://"+App.resolveSSDPAddress(address)+":8008/ssdp/device-desc.xml\r\n" +
            "OPT: \"http://schemas.upnp.org/upnp/1/0/\"; ns=01\r\n" +
            "01-NLS: baed804a-1dd1-11b2-8973-d7a6784427e5\r\n" +
            "SERVER: Linux/3.8.13, UPnP/1.0, Portable SDK for UPnP devices/1.6.18" +
            "X-User-Agent: redsonic\r\n" + 
            "ST: " + (ST == null ? "uuid:" + App.uuid : ST) + "\r\n"+
            "USN: uuid:" + App.uuid + (ST == null ? "" : ("::" + ST)) + "\r\n" +
            "BOOTID.UPNP.ORG: 7339\r\n" +                    
            "CONFIGID.UPNP.ORG: 7339\r\n" +                    
            "\r\n";
        
    }

    SSDPServer.prototype.onReceive = function(text,address,port){
        var lines = text.replace(/\r/g,"\n").split("\n");
        var params = {};
        params.action = lines[0];
        for (var i = 1, li = lines.length; i < li; i++){
            var line = lines[i];
            var parts = line.split(": ",2);
            if (parts.length > 1){
                params[parts[0]] = parts[1];
            }
        }
        try{
            var that = this;
            if (params.action.indexOf("M-SEARCH") == 0 && (params.ST == "urn:dial-multiscreen-org:service:dial:1" || params.ST == "urn:dial-multiscreen-org:device:dial:1" || params.ST == "ssdp:all")){
                var waitTime = parseInt(params.MX);
                if (isNaN) waitTime = 0;
                waitTime *= 1000;
                waitTime *= Math.random();
                setTimeout(function(){
                    var messages = [];
                    if (params.ST == "ssdp:all"){
                        messages.push(generateSSDPResponse(address,"upnp:rootdevice"));
                        messages.push(generateSSDPResponse(address,null));
                        messages.push(generateSSDPResponse(address,"urn:dial-multiscreen-org:device:dial:1"));
                        messages.push(generateSSDPResponse(address,"urn:dial-multiscreen-org:service:dial:1"));
                    }
                    else{
                        messages.push(generateSSDPResponse(address,params.ST));
                    }
                    function nextMessage(){
                        if (messages.length == 0)
                            return;
                        chrome.socket.sendTo(that.socketId,stringToArrayBuffer(messages.shift()),address,port,function(result){
                            nextMessage();
                        });  
                    }
                    nextMessage();
                },waitTime);
            }
        } catch (e){

        }

    }

    SSDPServer.prototype.getXMLDescription = function(address){
        var response = {};
        response.content = "<?xml version=\"1.0\"?>\r\n";
        response.content+= "<root xmlns=\"urn:schemas-upnp-org:device-1-0\">\r\n";
        response.content+= "  <specVersion>\r\n";
        response.content+= "    <major>1</major>\r\n";
        response.content+= "    <minor>0</minor>\r\n";
        response.content+= "  </specVersion>\r\n";
        response.content+= "  <URLBase>http://" + address +"</URLBase>\r\n";
        response.content+= "  <device>\r\n";
        response.content+= "    <deviceType>urn:dial-multiscreen-org:device:dial:1</deviceType>\r\n";
        response.content+= "    <friendlyName>" + App.friendlyName + "</friendlyName>\r\n";
        response.content+= "    <manufacturer>Google Inc.</manufacturer>\r\n";
        response.content+= "    <modelName>Eureka Dongle</modelName>\r\n";
        response.content+= "    <UDN>uuid:" + App.uuid + "</UDN>\r\n";
        response.content+= "    <iconList>\r\n";
        response.content+= "      <icon>\r\n";
        response.content+= "        <mimetype>image/png</mimetype>\r\n";
        response.content+= "        <width>98</width>\r\n";
        response.content+= "        <height>55</height>\r\n";
        response.content+= "        <depth>32</depth>\r\n";
        response.content+= "        <url>/setup/icon.png</url>\r\n";
        response.content+= "      </icon>\r\n";
        response.content+= "    </iconList>\r\n";
        response.content+= "    <serviceList>\r\n";
        response.content+= "      <service>\r\n";
        response.content+= "        <serviceType>urn:dial-multiscreen-org:service:dial:1</serviceType>\r\n";
        response.content+= "        <serviceId>urn:dial-multiscreen-org:serviceId:dial</serviceId>\r\n";
        response.content+= "        <controlURL>/ssdp/notfound</controlURL>\r\n";
        response.content+= "        <eventSubURL>/ssdp/notfound</eventSubURL>\r\n";
        response.content+= "        <SCPDURL>/ssdp/notfound</SCPDURL>\r\n";
        response.content+= "      </service>\r\n";
        response.content+= "    </serviceList>\r\n";
        response.content+= "  </device>\r\n";
        response.content+= "</root>\r\n";
        response.headers = {};
        response.headers["Content-Type"] = "application/xml";
        response.headers["Application-URL"] = "http://" + address + "/apps/";
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