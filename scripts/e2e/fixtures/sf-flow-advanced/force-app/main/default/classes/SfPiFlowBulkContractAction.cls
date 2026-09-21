/**
 * Deterministic bulk-safe invocable action used by the public SF Pi Flow runtime fixtures.
 */
public with sharing class SfPiFlowBulkContractAction {
    /** Input contract for one Flow interview. */
    public class Request {
        @InvocableVariable(label='Record Key' required=true)
        public String recordKey;

        @InvocableVariable(label='Record Name' required=true)
        public String recordName;
    }

    /** Ordered output contract for one Flow interview. */
    public class Result {
        @InvocableVariable(label='Record Key')
        public String recordKey;

        @InvocableVariable(label='Task Subject')
        public String taskSubject;

        @InvocableVariable(label='Request Count')
        public Integer requestCount;

        @InvocableVariable(label='Request Index')
        public Integer requestIndex;

        @InvocableVariable(label='Succeeded')
        public Boolean succeeded;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    /**
     * Produces one ordered result for every request without database mutation.
     *
     * @param requests Flow requests in platform batch order.
     * @return Results with the same size and order as the input list.
     */
    @InvocableMethod(
        label='SF Pi Build Related Task Details'
        description='Returns one ordered task-detail result for every Flow request.'
        category='SF Pi Test Fixtures'
    )
    public static List<Result> buildTaskDetails(List<Request> requests) {
        List<Result> results = new List<Result>();
        if (requests == null) {
            return results;
        }

        for (Integer index = 0; index < requests.size(); index++) {
            Request request = requests[index];
            Result result = new Result();
            result.requestCount = requests.size();
            result.requestIndex = index;
            if (request == null) {
                result.succeeded = false;
                result.errorMessage = 'Request is required.';
            } else {
                result.recordKey = request.recordKey;
                if (String.isBlank(request.recordName)) {
                    result.succeeded = false;
                    result.errorMessage = 'Record name is required.';
                } else {
                    result.taskSubject = 'SF Pi related review: ' + request.recordName;
                    result.succeeded = true;
                }
            }
            results.add(result);
        }
        return results;
    }
}
