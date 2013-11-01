define(function(){
    var WebSocket = function(request,onReady,frameReceived,onClosed){//create a websocket on the request
        this.socketId = request.socketId;
        this.frameReceived = frameReceived;
        this.onClosed = onClosed;
        this.onReady = onReady;
        this.dataBuffer = new ArrayBuffer(0);
        this.replyToHandshake(request);
    };
    
    var webSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    
    WebSocket.prototype.replyToHandshake = function(request){
        var response = request.webserver.createHTTPResponse();
        response.setCode(101);
        response.headers["Connection"] = "Upgrade";
        response.headers["Upgrade"] = "websocket";
        response.headers["Sec-WebSocket-Accept"] = Sha1Base64(request.headers["Sec-WebSocket-Key"].trim() + webSocketGUID);
        response.generateHeaders();
        var that = this;
        chrome.socket.write(request.socketId,response.toArrayBuffer(),function(){
            that.onReady(that);
            that.listen();
            
        });
        
    }

    var opcode_continuation = 0;
    var opcode_text = 1;
    var opcode_binary = 2;
    var opcode_close = 8;
    var opcode_ping = 9;
    var opcode_pong = 10;



    WebSocket.prototype.consumeFragment = function(){
        var data = new Uint8Array(this.dataBuffer);
        if (data.length < 2)
            return false;

        var i = 0;
        var finalFragment = (data[i] & 128) != 0;
        var opcode = data[i++] & 0xF;
        var masked = (data[i] & 128) != 0;
        var payloadLength = data[i++] & 127;
        if (payloadLength == 126){
            payloadLength = (data[i++] << 8 )| data[i++];
        }
        else if (payloadLength == 127){
            payloadLength = (data[i++] << 24) | (data[i++] << 16) | (data[i++] << 8 )| data[i++];
        }
        var maskingKey = new Uint8Array(4);
        if (masked){
            for (var j = 0; j < 4; j++, i++){
                maskingKey[j] = data[i];
            }
        }
        if (data.length < payloadLength + i){
            return false;
        }
        var applicationData = new Uint8Array(payloadLength);
        for (var j = 0; j < payloadLength; j++, i++){
            if (masked){
                applicationData[j] = data[i] ^ maskingKey[j % 4];
            }
            else{
                applicationData[j] = data[i];
            }
        }
        this.dataBuffer = this.dataBuffer.slice(i);
        if (finalFragment){
            if (this.buildingFrame != null){
                if (opcode != opcode_continuation){
                    console.error("incomplete frame!");
                    this.close();
                    return true;
                }
                applicationData = joinBuffers(this.buildingFrame.dataBuffer,applicationData);
                opcode = this.buildingFrame.opcode;
            }
            switch (opcode){
                case opcode_text:
                    var text = arrayBufferToString(applicationData);
                    this.frameReceived(this,text);
                    break;
                case opcode_binary:
                    this.frameReceived(this,applicationData);
                case opcode_close:
                    this.onClosed(this);
                    if (this.closing){
                        this.onClosed = function(){};
                        chrome.socket.destroy(this.socketId);
                    }
                    else{
                        this.closing = true;
                        this.close();
                    }
                    break;
                case opcode_pong:
                    break;
                case opcode_ping:
                    this.sendPong(applicationData);
                    break;
                case opcode_continuation:
                    console.error("initial frame can't be continuation!");
                    this.close();
                    break;
                default:
                    console.error("unhandled websocket opcode 0x" + opcode.toString(16).toUpperCase());
                    this.close();
                    break;

            }
        }
        else{
            if (this.buildingFrame == null)
                this.buildingFrame = {opcode: opcode, dataBuffer: applicationData};
            else{
                if (opcode != opcode_continuation){
                    console.error("incomplete frame!");
                    this.close();
                }
                else{
                    this.buildingFrame.dataBuffer = joinBuffers(this.buildingFrame.dataBuffer,applicationData);
                }
            }
        }
        return true;
    }
    
    WebSocket.prototype.listen = function(){
        if (this.closing)
            return;
        var that = this;
        chrome.socket.read(this.socketId,function(readInfo){
            if (readInfo.resultCode < 0){
                that.onClosed(that);
                that.onClosed = function(){};
                return;
            }
            that.dataBuffer = joinBuffers(that.dataBuffer,readInfo.data);
            while (that.consumeFragment());
            that.listen();

        })
    }

    WebSocket.prototype.close = function(){
        var frameData = new Uint8Array(2);
        frameData[0] = 128 | opcode_close;
        frameData[1] = 0;
        var that = this;
        chrome.socket.write(this.socketId,frameData.buffer,function(result){
            if (that.closing){
                that.onClosed = function(){};
                chrome.socket.destroy(that.socketId);
            }
            else{
                that.closing = true;
            }
        });
    }

    WebSocket.prototype._sendFrame = function(opcode,data,masked,finalFragment){
        var payloadLength = data.byteLength;
        var totalSize = payloadLength + (payloadLength <= 125 ? 1 : payloadLength <= 65535 ? 3 : 5) + 1;
        var frameData = new Uint8Array(totalSize);
        var i = 0;
        frameData[i++] = (finalFragment == true ? 128 : 0) | (opcode & 0xF);
        if (payloadLength <= 125){
            frameData[i++] = payloadLength;
        }
        else if (payloadLength <= 65535){
            frameData[i++] = 126;
            frameData[i++] = (payloadLength >> 8) & 0xFF;
            frameData[i++] = payloadLength & 0xFF;
        }
        else{
            frameData[i++] = 126;
            frameData[i++] = (payloadLength >> 24) & 0xFF;
            frameData[i++] = (payloadLength >> 16) & 0xFF;
            frameData[i++] = (payloadLength >> 8) & 0xFF;
            frameData[i++] = payloadLength & 0xFF;
        }
        for (var j = 0; j < payloadLength; j++, i++){
            frameData[i] = data[j];
        }
        chrome.socket.write(this.socketId,frameData.buffer,function(result){
        });
    }

    WebSocket.prototype.sendFrame = function(data){
        var dataBuffer;
        var opcode;
        if (typeof data == "string"){
            dataBuffer = new Uint8Array(stringToArrayBuffer(data));
            opcode = opcode_text;
        }
        else if (typeof data == "object" && data.byteLength != null){
            dataBuffer = new Uint8Array(data);
            opcode = opcode_binary;
        }
        else{
            console.error("Websocket: tried to send unsupported data!");
            return false;
        }
        var masked = false;
        var finalFragment = true;
        this._sendFrame(opcode,dataBuffer,masked,finalFragment);
        return true;
    }

    WebSocket.prototype.sendPong = function(data){
        var dataBuffer = new Uint8Array(data);
        var masked = false;
        var opcode = opcode_pong;
        var finalFragment = true;
        this._sendFrame(opcode,dataBuffer,masked,finalFragment);
    }
    WebSocket.prototype.sendPing = function(data){
        var dataBuffer = new Uint8Array(data);
        var masked = false;
        var opcode = opcode_ping;
        var finalFragment = true;
        this._sendFrame(opcode,dataBuffer,masked,finalFragment);
    }
    
    
    WebSocket.isWebSocketHandshakeRequest = function(request){
        return request.headers["Connection"].toLowerCase() == "upgrade" && request.headers["Upgrade"].toLowerCase() == "websocket" && request.headers["Sec-WebSocket-Key"] != null;
    }
    
    
    function Sha1Base64(str){
        var s = Sha1(str);
        var result = "";
        for (var i = 0; i < 20; i++){
            result += String.fromCharCode(parseInt(s.substr(i*2,2),16));
        }
        return btoa(result);
    }
    
    return WebSocket;
});