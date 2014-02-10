define(["WebRequestResponder"],function(WebRequestResponder){
    var WebServer = function(ip, port, retryTillSuccess){
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

        this.responders = [];

    };

    var defaultResponders = [];
    defaultResponders.push(new WebRequestResponder(/.*?/,["GET","POST","PUT","DELETE"],function(request){
        console.warn("unhandled request URI");
        console.warn(request)
        var response = request.webserver.createHTTPResponse();
        response.setCode(404);
        request.webserver.sendResponse(request,response);

    }));

    WebServer.prototype.addResponder = function(responder){
        this.responders.push(responder);
    }

    WebServer.prototype._onAccept = function(acceptInfo){
        if (this.stopped)
            return;
        var that = this;
        this._readData(acceptInfo.socketId);
        chrome.socket.accept(this.socketId,function(acceptInfo){
            that._onAccept(acceptInfo);
        });
    };

    WebServer.prototype._readData = function(socketId){
        if (this.stopped)
            return;
        var that = this;
        chrome.socket.read(socketId,function(readInfo){
            var stringData = arrayBufferToString(readInfo.data);
            if (stringData == ""){
                chrome.socket.destroy(socketId);
                return;
            }
            var lines = stringData.split("\r\n");
            var requestHeaders = {};
            var request = lines[0].split(" ");
            var requestAction = request[0];
            var requestPath = request[1];
            var i;
            for (i = 1, li = lines.length; i < li; i++){
                if (lines[i] == ""){
                    break;
                }
                var parts = lines[i].split(": ");
                requestHeaders[parts[0]] = parts[1];
            }
            var postData = stringData.substring(stringData.indexOf("\r\n\r\n") + 4);
            var queryParams = {};
            if (requestPath.indexOf("?") > 0){
                var parts = requestPath.split("?");
                requestPath = parts[0];
                var queryParts = parts[1].split("&");
                for (var i = 0, li = queryParts.length; i < li; i++){
                    var parts = queryParts[i].split("=");
                    queryParams[parts[0]] = decodeURIComponent(parts[1]);
                }
            }

            function readMore(){
                if (requestHeaders["Content-Length"] != null && postData.length != requestHeaders["Content-Length"]){
                    chrome.socket.read(socketId,function(readInfo){
                        var additionalData = arrayBufferToString(readInfo.data);
                        postData += additionalData;
                        readMore();
                    });
                }
                else{
                    dispatchRequest();
                }

            }
            readMore();
            function dispatchRequest(){
                request = {method: requestAction, path: requestPath, headers: requestHeaders, webserver: that, socketId: socketId, postData: postData, queryParams: queryParams};
                if (!that.handleRequest(request)){
                    console.error("no handler for request!");
                    console.error(request);
                    chrome.socket.destroy(request.socketId);

                };
            }

        });
    }

    WebServer.prototype.handleRequest = function(request){
        console.log("Webserver: " + request.method + " " + request.headers["Host"] + request.path);
        for (var i = 0, li = this.responders.length; i < li; i++){
            if (this.responders[i]._handleRequest(request)){
                return true;
            }
        }
        for (var i = 0, li = defaultResponders.length; i < li; i++){
            if (defaultResponders[i]._handleRequest(request)){
                return true;
            }
        }
        return false;
    }

    WebServer.prototype.sendResponse = function(request,response){
        response.generateHeaders();
        chrome.socket.write(request.socketId,response.toArrayBuffer(),function(result){
            if (request.headers["Connection"] != null && request.headers["Connection"].toLowerCase() == "keep-alive"){
                request.webserver._readData(request.socketId);
            }
            else{
                chrome.socket.destroy(request.socketId);
            }
        })
    }

    var HTTPResponse = function(){
        this.setCode(200);
        this.httpVersion = "HTTP/1.1";
        this.headers = {};
        this.content = null;

    }

    var responseCodeText = {
        100: "Continue",
        101: "Switching Protocols",
        102: "Processing",
        200: "OK",
        201: "Created",
        202: "Accepted",
        203: "Non-Authoritative Information",
        204: "No Content",
        205: "Reset Content",
        206: "Partial Content",
        207: "Multi-Status",
        208: "Already Reported",
        226: "IM Used",
        300: "Multiple Choices",
        301: "Moved Permanently",
        302: "Found",
        303: "See Other",
        304: "Not Modified",
        305: "Use Proxy",
        306: "Switch Proxy",
        307: "Temporary Redirect",
        308: "Permanent Redirect",
        400: "Bad Request",
        401: "Unauthorized",
        402: "Payment Required",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        406: "Not Acceptable",
        407: "Proxy Authentication Required",
        408: "Request Timeout",
        409: "Conflict",
        410: "Gone",
        411: "Length Required",
        412: "Precondition Failed",
        413: "Request Entity Too Large",
        414: "Request-URI Too Long",
        415: "Unsupported Media Type",
        416: "Requested Range Not Satisfiable",
        417: "Expectation Failed",
        418: "I'm a teapot",
        419: "Authentication Timeout",
        420: "Method Failure",
        422: "Unprocessable Entity",
        423: "Locked",
        424: "Failed Dependency",
        425: "Unordered Collection",
        426: "Upgrade Required",
        428: "Precondition Required",
        429: "Too Many Requests",
        431: "Request Header Fields Too Large",
        444: "No Response",
        449: "Retry With",
        450: "Blocked by Windows Parental Controls",
        451: "Redirect",
        494: "Request Header Too large",
        495: "Cert Error",
        496: "No Cert",
        497: "HTTP to HTTPS",
        499: "Client Closed Request",
        500: "Internal Server Error",
        501: "Not Implemented",
        502: "Bad Gateway",
        503: "Service Unavailable",
        504: "Gateway Timeout",
        505: "HTTP Version Not Supported",
        506: "Variant Also Negotiates",
        507: "Insufficient Storage",
        508: "Loop Detected",
        509: "Bandwidth Limit Exceeded",
        510: "Not Extended",
        511: "Network Authentication Required",
        522: "Connection timed out",
        598: "Network read timeout error",
        599: "Network connect timeout error"

    }

    HTTPResponse.prototype.setCode = function(code){
        this.code = code
        this.codeText = responseCodeText[code];
        if (this.codeText == null)
            this.codeText = "";
    }

    HTTPResponse.prototype.toString = function(){
        var text = this.httpVersion + " " + this.code + " " + this.codeText;
        for (var name in this.headers){
            text += "\r\n" + name + ": " + this.headers[name];
        }
        text += "\r\n\r\n";
        text += this.sendableContent;
        return text;

    }

    HTTPResponse.prototype.generateHeaders = function(){
        switch (typeof this.content){
            case "string":
                this.headers["Content-Length"] = this.content.length;
                if (this.headers["Content-Type"] == null)
                    this.headers["Content-Type"] = "text/html";
                this.sendableContent = this.content;
                break;
            default:
                this.headers["Content-Length"] = 0;
                this.sendableContent = "";
                break;
        }
        this.headers["Date"] = new Date().toUTCString();
    }

    HTTPResponse.prototype.toArrayBuffer = function(){
        return stringToArrayBuffer(this.toString());

    }

    WebServer.prototype.createHTTPResponse = function(){
        return new HTTPResponse();
    }

    WebServer.prototype.stop = function(){
        chrome.socket.destroy(this.socketId);
        this.stopped = true;
    }

    return WebServer;

});