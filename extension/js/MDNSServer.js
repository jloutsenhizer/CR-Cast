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
        var position = 0;
        var errored = false;
        result.transactionID = consumeWord();
        var flags = consumeWord();
        result.isQuery = (flags & 0x8000) == 0;
        result.opCode = (flags >> 11) & 0xF
        result.authoritativeAnswer = (flags & 0x400) != 0;
        result.truncated = (flags & 0x200) != 0;
        result.recursionDesired = (flags & 0x100) != 0;
        result.recusionAvailable = (flags & 0x80) != 0;
        result.responseCode = flags & 0xF;
        var questionCount = consumeWord();
        var answerCount = consumeWord();
        var authorityRecordsCount = consumeWord();
        var additionalRecordsCount = consumeWord();
        result.questions = [];
        result.answers = [];
        result.autorityRecords = [];
        result.additionalRecords = [];

        function consumeDNSName(){

            var parts = [];
            while (true){
                if (position >= rawData.byteLength){
                    break;
                }
                var partLength = consumeByte();
                if (partLength == 0)
                    break;
                if (partLength == 0xC0){
                    var bytePosition = consumeByte();
                    var oldPosition = position;
                    position = bytePosition;
                    parts = parts.concat(consumeDNSName().split("."));
                    position = oldPosition;
                    break;
                }
                if (position + partLength > rawData.byteLength){
                    if (!errored){
                        errored = true;
                        console.error("mDNS packet received that's too short!");
                    }
                    partLength = rawData.byteLength - position;
                }
                var part = "";
                while (partLength-- > 0)
                    part += String.fromCharCode(consumeByte());
                parts.push(part);
            }
            return parts.join(".");
        }

        function consumeByte(){
            if (position + 1 > rawData.byteLength){
                if (!errored){
                    errored = true;
                    console.error("mDNS packet received that's too short!");
                }
                return 0;
            }
            return rawData[position++];
        }
        function consumeWord(){
            return (consumeByte() << 8) | consumeByte();
        }
        function consumeDWord(){
            return (consumeWord() << 16) | consumeWord();
        }
        function consumeQuestion(){
            var question = {};    
            question.name = consumeDNSName();
            question.type = consumeWord();
            question.class = consumeWord();
            question.flushCache = (question.class & 0x8000) != 0;
            question.class &= 0x7FFF;
            return question;
        }
        function consumeByteArray(length){
            length = Math.min(length,rawData.byteLength - position);
            var data = new Uint8Array(length);
            for (var i = 0; i < length; i++){
                data[i] = consumeByte();
            } 
            return data;
        }
        for (var i = 0; i < questionCount; i++){
            result.questions.push(consumeQuestion());
        }
        function consumeResourceRecord(){
            var resource = {};
            resource.name = consumeDNSName();
            resource.type = consumeWord();
            resource.class = consumeWord();
            resource.flushCache = (resource.class & 0x8000) != 0;
            resource.class &= 0x7FFF;
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

    function encodeMDNSMessage(message){
        var data = [];
        var DNSNameMapping = {};

        writeWord(message.transactionID);
        var flags = 0;
        if (!message.isQuery)
            flags |= 0x8000;
        flags |= (message.opCode & 0xFF) << 11;
        if (message.authoritativeAnswer)
            flags |= 0x400;
        if (message.truncated)
            flags |= 0x200;
        if (message.recursionDesired)
            flags |= 0x100;
        if (message.recusionAvailable)
            flags |= 0x80;
        flags |= message.responseCode & 0xF;
        writeWord(flags);
        writeWord(message.questions.length);
        writeWord(message.answers.length);
        writeWord(message.autorityRecords.length);
        writeWord(message.additionalRecords.length);

        var i, li;
        for (i = 0, li = message.questions.length; i < li; i++){
            writeQuestion(message.questions[i]);
        }
        for (i = 0, li = message.answers.length; i < li; i++){
            writeRecord(message.answers[i]);
        }
        for (i = 0, li = message.autorityRecords.length; i < li; i++){
            writeRecord(message.autorityRecords[i]);
        }
        for (i = 0, li = message.additionalRecords.length; i < li; i++){
            writeRecord(message.additionalRecords[i]);
        }

        return new Uint8Array(data);

        function writeByte(b){
            data.push(b);
        }

        function writeWord(w){
            writeByte(w >> 8);
            writeByte(w & 0xFF);
        }

        function writeDWord(d){
            writeWord(d >> 16);
            writeWord(d & 0xFFFF);
        }

        function writeByteArray(b){
            for (var i = 0, li = b.length; i < li; i++){
                writeByte(b[i]);
            }
        }

        function writeDNSName(n){
            var parts = n.split(".");
            var brokeEarly = false;
            for (var i = 0, li = parts.length; i < li; i++){
                var remainingString = parts.slice(i).join(".");
                var location = DNSNameMapping[remainingString];
                if (location != null){
                    brokeEarly = true;
                    writeByte(0xC0);
                    writeByte(location);
                    break;
                }
                if (data.length < 256){//we can't ever shortcut to a position after the first 256 bytes
                    DNSNameMapping[remainingString] = data.length;
                }
                var part = parts[i];
                writeByte(part.length);
                for (var j = 0, lj = part.length; j < lj; j++){
                    writeByte(part.charCodeAt(j));
                }
            }
            if (!brokeEarly)
                writeByte(0);
        }

        function writeQuestion(q){
            writeDNSName(q.name);
            writeWord(q.type);
            writeWord(q.class | (q.flushCache ? 0x8000 : 0));
        }
        function writeRecord(r){
            writeDNSName(r.name);
            writeWord(r.type);
            writeWord(r.class | (r.flushCache ? 0x8000 : 0));
            writeDWord(r.timeToLive);
            switch (r.type){
                default:
                    writeByteArray(r.resourceData);
            }
        }
    }


    MDNSServer.prototype.onReceive = function(data,address,port){
        var message = parseMDNSMessage(data);
        var message2 = parseMDNSMessage(encodeMDNSMessage(message));
        console.log(message);
        console.log(message2);
        for (var i = 0, li = message.questions.length; i < li; i++){
            var question = message.questions[i];
            if (question.name == "_googlecast._tcp.local"){
                console.log("Should reply to this");                
            }
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