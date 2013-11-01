define(function(){
    var WebRequestHandler = function(pathOrPattern,methods,onRequest){
        this.path = pathOrPattern;
        this.methods = methods;
        this.onRequest = onRequest;

    }

    WebRequestHandler.prototype._handleRequest = function(request){
        if (this.methods.indexOf(request.method.toUpperCase()) != -1){
            if ((typeof this.path == "string" && request.path == this.path) || (typeof this.path == "object" && this.path.test(request.path))){
                    this.onRequest(request);
                    return true;
            }
        }
        return false;
    }



    return WebRequestHandler;
})