/** Deterministic success and failure action used by the SF Pi Flow runtime fixtures. */
public with sharing class SfPiFlowFaultAction {
    /** Input contract for one Flow interview. */
    public class Request {
        @InvocableVariable(label='Should Fail' required=true)
        public Boolean shouldFail;

        @InvocableVariable(label='Marker' required=true)
        public String marker;
    }

    /** Output contract for one Flow interview. */
    public class Result {
        @InvocableVariable(label='Marker')
        public String marker;
    }

    /** Raised only when the fixture explicitly requests an action fault. */
    public class ForcedFaultException extends Exception {}

    /**
     * Returns ordered results or raises one deterministic action fault.
     * @param requests ordered Flow requests
     * @return one result for each request
     */
    @InvocableMethod(
        label='SF Pi Force Flow Action Fault'
        description='Returns the marker unless the request explicitly asks for a deterministic fault.'
        category='SF Pi Test Fixtures'
    )
    public static List<Result> execute(List<Request> requests) {
        List<Result> results = new List<Result>();
        if (requests == null) {
            return results;
        }
        for (Request request : requests) {
            if (request == null || request.shouldFail == true) {
                throw new ForcedFaultException('SF Pi forced action fault.');
            }
            Result result = new Result();
            result.marker = request.marker;
            results.add(result);
        }
        return results;
    }
}
