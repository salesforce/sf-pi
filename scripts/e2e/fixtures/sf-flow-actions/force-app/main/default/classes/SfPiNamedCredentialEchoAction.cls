/**
 * Named Credential-backed invocable callout fixture for SF Flow runtime proofs.
 */
public with sharing class SfPiNamedCredentialEchoAction {
    /** Marker input exposed to Flow. */
    public class Request {
        @InvocableVariable(label='Marker' required=true)
        public String marker;
    }

    /** Echo result returned to Flow. */
    public class Result {
        @InvocableVariable(label='Echoed Marker')
        public String echoedMarker;

        @InvocableVariable(label='Status Code')
        public Integer statusCode;

        @InvocableVariable(label='Succeeded')
        public Boolean succeeded;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    /**
     * Calls the public echo endpoint through the SfPi_Public_Echo_Legacy Named Credential.
     * @param requests ordered marker requests
     * @return ordered per-request callout results
     */
    @InvocableMethod(
        label='Call Named Credential Echo'
        description='Calls a public echo endpoint through a Named Credential and returns ordered per-request results.'
        callout=true
    )
    public static List<Result> echo(List<Request> requests) {
        List<Result> results = new List<Result>();
        if (requests == null) {
            return results;
        }
        Http client = new Http();
        for (Request request : requests) {
            results.add(echoRequest(client, request));
        }
        return results;
    }

    private static Result echoRequest(Http client, Request request) {
        Result result = new Result();
        try {
            requireMarker(request);
            HttpResponse response = client.send(buildRequest(request.marker));
            result.statusCode = response.getStatusCode();
            requireSuccessStatus(result.statusCode);
            result.echoedMarker = echoedMarker(response.getBody());
            result.succeeded = result.echoedMarker == request.marker;
            if (!result.succeeded) {
                result.errorMessage = 'Echoed marker did not match the request.';
            }
        } catch (Exception error) {
            result.succeeded = false;
            result.errorMessage = error.getMessage();
        }
        return result;
    }

    private static void requireMarker(Request request) {
        if (request == null || String.isBlank(request.marker)) {
            throw new IllegalArgumentException('Marker is required.');
        }
    }

    private static HttpRequest buildRequest(String marker) {
        HttpRequest request = new HttpRequest();
        request.setMethod('GET');
        request.setEndpoint(
            'callout:SfPi_Public_Echo_Legacy/get?marker=' +
            EncodingUtil.urlEncode(marker, 'UTF-8')
        );
        return request;
    }

    private static void requireSuccessStatus(Integer statusCode) {
        if (statusCode < 200 || statusCode >= 300) {
            throw new CalloutException('Echo endpoint returned HTTP ' + statusCode + '.');
        }
    }

    private static String echoedMarker(String body) {
        Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(body);
        Map<String, Object> arguments = (Map<String, Object>) payload.get('args');
        return String.valueOf(arguments.get('marker'));
    }
}
