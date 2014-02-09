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


    var CLASS_IN = 1;

    var TYPE_A    = 0x0001;//host address
    var TYPE_PTR  = 0x000C;
    var TYPE_TXT  = 0x0010;
    var TYPE_SRV  = 0x0021;//service location
    var TYPE_NSEC = 0x002F;//next secured

    
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
        result.recursionAvailable = (flags & 0x80) != 0;
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
            question.unicastResponseRequested = (question.class & 0x8000) != 0;
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
        var textMapping = {};

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
        if (message.recursionAvailable)
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

        function writeByte(b,pos){
            if (pos != null){
                data[pos] = b;
            }
            else{
                data.push(b);
            }
            return 1;
        }

        function writeWord(w, pos){
            if (pos != null){
                return writeByte(w >> 8,pos) + writeByte(w & 0xFF,pos + 1);
            }
            return writeByte(w >> 8) + writeByte(w & 0xFF);
        }

        function writeDWord(d){
            return  writeWord(d >> 16) + writeWord(d & 0xFFFF);
        }

        function writeByteArray(b){
            var bytesWritten = 0;
            for (var i = 0, li = b.length; i < li; i++){
                bytesWritten += writeByte(b[i]);
            }
            return bytesWritten;
        }

        function writeIPAddress(a){
            var parts = a.split(".");
            var bytesWritten = 0;
            for (var i = 0, li = parts.length; i < li; i++){
                bytesWritten += writeByte(parseInt(parts[i]));
            }
            return bytesWritten;
        }

        function writeStringArray(parts,includeLastTerminator){
            var brokeEarly = false;
            var bytesWritten = 0;
            for (var i = 0, li = parts.length; i < li; i++){
                var remainingString = parts.slice(i).join("._-_.");
                var location = textMapping[remainingString];
                if (location != null){
                    brokeEarly = true;
                    bytesWritten += writeByte(0xC0);
                    bytesWritten += writeByte(location);
                    break;
                }
                if (data.length < 256){//we can't ever shortcut to a position after the first 256 bytes
                    textMapping[remainingString] = data.length;
                }
                var part = parts[i];
                bytesWritten += writeByte(part.length);
                for (var j = 0, lj = part.length; j < lj; j++){
                    bytesWritten += writeByte(part.charCodeAt(j));
                }
            }
            if (!brokeEarly && includeLastTerminator)
                bytesWritten += writeByte(0);
            return bytesWritten;


        }

        function writeDNSName(n){
            var parts = n.split(".");
            return writeStringArray(parts,true);
        }

        function writeQuestion(q){
            writeDNSName(q.name);
            writeWord(q.type);
            writeWord(q.class | (q.unicastResponseRequested ? 0x8000 : 0));
        }
        function writeRecord(r){
            writeDNSName(r.name);
            writeWord(r.type);
            writeWord(r.class | (r.flushCache ? 0x8000 : 0));
            writeDWord(r.timeToLive);
            switch (r.type){
                case TYPE_NSEC:
                    var lengthPos = data.length;
                    writeWord(0);
                    var length = writeDNSName(r.nsec_domainName);
                    length += writeByte(0);//offset (always 0)
                    r.nsec_types.sort();
                    var bytesNeeded = Math.ceil(r.nsec_types[r.nsec_types.length - 1] / 8);
                    length += writeByte(bytesNeeded);
                    var bitMapArray = new Uint8Array(bytesNeeded);
                    for (var i = 0, li = r.nsec_types.length; i < li; i++){
                        var type= r.nsec_types[i];
                        var byteNum = Math.floor(type / 8);
                        var bitNum = type % 8;
                        bitMapArray[byteNum] |= 1 << (7 - bitNum);
                    }
                    length += writeByteArray(bitMapArray);
                    writeWord(length,lengthPos);
                    break;
                case TYPE_TXT:
                    var lengthPos = data.length;
                    writeWord(0);
                    var length = writeStringArray(r.txt_texts,false);
                    writeWord(length,lengthPos);
                    break;
                case TYPE_A:
                    var lengthPos = data.length;
                    writeWord(0);
                    var length = writeIPAddress(r.a_address);
                    writeWord(length,lengthPos);
                    break;
                case TYPE_SRV:
                    var lengthPos = data.length;
                    writeWord(0);
                    var length = writeWord(r.srv_priority);
                    length += writeWord(r.srv_weight);
                    length += writeWord(r.srv_port);
                    length += writeDNSName(r.srv_target);
                    writeWord(length,lengthPos);
                    break;
                case TYPE_PTR:
                    var lengthPos = data.length;
                    writeWord(0);
                    var length = writeDNSName(r.ptr_domainName);
                    writeWord(length,lengthPos);
                    break;
                default:
                    writeWord(r.resourceData.byteLength);
                    writeByteArray(r.resourceData);
            }
        }
    }

    function getPTRResponse(transactionID,address){
        var response = {
            transactionID: transactionID,
            isQuery: false,
            opCode: 0,
            authoritativeAnswer: true,
            truncated: false,
            recursionDesired: false,
            recursionAvailable: false,
            responseCode: RESPONSE_CODE_OK,
            questions: [],
            answers: [],
            additionalRecords: [],
            autorityRecords: []
        };
        response.additionalRecords.push({
            name: App.friendlyName + "._googlecast._tcp.local",
            type: TYPE_TXT,
            class: CLASS_IN,
            flushCache: true,
            timeToLive: Math.floor(1.25*60*60),//1 hour 15 minutes
            txt_texts:[
                "id=" + App.uuid.replace(/-/g,""),
                "ve=02",
                "md=Chromecast",
                "ic=/setup/icon.png"
            ]
        });
        response.answers.push({
            name: "_googlecast._tcp.local",
            type: TYPE_PTR,
            class: CLASS_IN,
            flushCache: true,
            timeToLive: Math.floor(1.25*60*60),//1 hour 15 minutes
            ptr_domainName: App.friendlyName + "._googlecast._tcp.local"
        });
        response.additionalRecords.push({
            name: App.friendlyName + "._googlecast._tcp.local",
            type: TYPE_SRV,
            class: CLASS_IN,
            flushCache: true,
            timeToLive: 60 * 2,//2 minutes
            srv_priority: 0,
            srv_weight: 0,
            srv_port: 8009,
            srv_target: App.friendlyName + ".local"
        });
        response.additionalRecords.push({
            name:App.friendlyName + ".local",
            type: TYPE_A,
            class: CLASS_IN,
            flushCache: true,
            timeToLive: 2 * 60,//2 minutes
            a_address: App.resolveSSDPAddress(address)
        });
        response.additionalRecords.push({
            name: App.friendlyName + "._googlecast._tcp.local",
            type: TYPE_NSEC,
            class: CLASS_IN,
            flushCache: true,
            timeToLive: Math.floor(1.25*60*60),//1 hour 15 minutes,
            nsec_domainName: App.friendlyName + "._googlecast._tcp.local",
            nsec_types:[TYPE_TXT,TYPE_SRV]
        });
        response.additionalRecords.push({
            name: App.friendlyName + ".local",
            type: TYPE_NSEC,
            class: CLASS_IN,
            flushCache: true,
            timeToLive: Math.floor(1.25*60*60),//1 hour 15 minutes,
            nsec_domainName: App.friendlyName + ".local",
            nsec_types:[TYPE_A]
        })
        return response;
    }


    MDNSServer.prototype.onReceive = function(data,address,port){
        var that = this;
        var message = parseMDNSMessage(data);
        for (var i = 0, li = message.questions.length; i < li; i++){
            var question = message.questions[i];
            if (question.name == "_googlecast._tcp.local"){//question is for the googlecast domain
                if (question.type == TYPE_PTR){//lookup ptr record
                    console.log("responding to PTR query");
                    var targetAddress = MDNS_ADDRESS;
                    var targetPort = MDNS_PORT;
                    if (question.unicastResponseRequested){
                        targetAddress = address;
                        targetPort = port;
                        console.log("Response will be unicast");
                    }

                    chrome.socket.sendTo(that.socketId,encodeMDNSMessage(getPTRResponse(message.transactionID,address)).buffer,targetAddress,targetPort,function(result){
                        console.log("response done: ");
                        console.log(result);
                    });
                }
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