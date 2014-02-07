define(function(){

    var MDNS_ADDRESS = "224.0.0.251";
    var MDNS_PORT = 5353;

    var MDNSServer = function(onReady){
        var that = this;
        that.socketId = null;

        chrome.socket.create("udp",{},function(createInfo){
            that.socketId = createInfo.socketId;
            chrome.socket.setMulticastTimeToLive(that.socketId,20,function(result){
                chrome.socket.setMulticastLoopbackMode(that.socketId,true,function(result){
                    chrome.socket.bind(that.socketId,"0.0.0.0",MDNS_PORT,function(result){
                        chrome.socket.joinGroup(that.socketId,MDNS_ADDRESS,function(result){
                            that.running = true;
                            that._listen();
                            if (onReady != null)
                                onReady();

                        });
                    });
                }) ;
            });

        });
    };
    
    var OPCODE_QUERY = 0;
    var OPCODE_INVERSE_QUERY = 1;
    var OPCODE_STATUS = 2;
    
    var RESPONSE_CODE_OK = 0;
    var RESPONSE_CODE_FORMAT_ERROR = 1;
    var RESPONSE_CODE_SERVER_ERROR = 2;
    var RESPONSE_CODE_NAME_ERROR = 3;
    var RESPONSE_CODE_NOT_IMPLEMENTED = 4;
    var RESPONSE_CODE_REFUSED = 5;
    
    function parseMDNSMessage(rawData){
        var result = {};
        result.transactionID = (rawData[0] << 8) | rawData[1];
        var flags = (rawData[2] << 8) | rawData[3];
        result.isQuery = (flags & 0x8000) == 0;
        result.opCode = (flags >> 11) & 0xF
        result.authoritativeAnswer = (flags & 0x400) != 0;
        result.truncated = (flags & 0x200) != 0;
        result.recursionDesired = (flags & 0x100) != 0;
        result.recusionAvailable = (flags & 0x80) != 0;
        result.responseCode = flags & 0xF;
        var questionCount = (rawData[4] << 8) | rawData[5];
        var answerCount = (rawData[6] << 8) | rawData[7];
        var authorityRecordsCount = (rawData[8] << 8) | rawData[9];
        var additionalRecordsCount = (rawData[10] << 8) | rawData[11];
        result.questions = [];
        result.answers = [];
        result.autorityRecords = [];
        result.additionalRecords = [];
        var position = 12;
        function consumeDNSName(){
            var parts = [];
            while (true){
                var partLength = rawData[position++];
                if (partLength == 0)
                    break;
                var part = "";
                while (partLength-- > 0)
                    part += String.fromCharCode(rawData[position++]);
                parts.push(part);
            }
            return parts.join(".");
        }
        function consumeWord(){
            return (rawData[position++] << 8) | rawData[position++];
        }
        function consumeDWord(){
            return (consumeWord() << 16) | consumeWord();
        }
        function consumeQuestion(){
            var question = {};    
            question.name = consumeDNSName();
            question.type = consumeWord();
            question.class = consumeWord();
            return question;
        }
        function consumeByteArray(length){
            var data = new Uint8Array(length);
            for (var i = 0; i < length; i++){
                data[i] = rawData[position++];
            }            
        }
        for (var i = 0; i < questionCount; i++){
            result.questions.push(consumeQuestion());
        }
        function consumeResourceRecord(){
            var resource = {};
            resource.name = consumeDNSName();
            resource.type = consumeWord();
            resource.class = consumeWord();
            resource.timeToLive = consumeDWord();
            var extraDataLength = consumeWord();
            resource.resourceData = consumeByteArray(extraDataLength);
            return resource;
        }
        for (var i = 0; i < answerCount; i++){
            result.answers.push(consumeResourceRecord());
        }
        for (var i = 0; i < authorityRecordsCount; i++){
            result.autorityRecords.push(consumeResourceRecord());
        }
        for (var i = 0; i < additionalRecordsCount; i++){
            result.additionalRecords.push(consumeResourceRecord());
        }
        return result;        
    }

    MDNSServer.prototype.onReceive = function(data,address,port){
        var message = parseMDNSMessage(data);
        for (var i = 0, li = message.questions.length; i < li; i++){
            var question = message.questions[i];
            console.log(question);
        }
    };

    MDNSServer.prototype._listen = function(){
        if (!this.running)
            return;
        var that = this;
        chrome.socket.recvFrom(this.socketId,1048576,function(result){
            that.onReceive(new Uint8Array(result.data),result.address,result.port);
            that._listen();
        });
    };

    MDNSServer.prototype.stop = function(){
        this.running = false;
        chrome.socket.destroy(this.socketId);
    };

    return MDNSServer;

});