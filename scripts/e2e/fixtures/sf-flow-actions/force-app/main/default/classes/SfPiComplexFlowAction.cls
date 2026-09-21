/**
 * Bulk-safe fixture action that proves complex Flow input and output contracts.
 */
public with sharing class SfPiComplexFlowAction {
    /** Mixed input contract exposed to Flow. */
    public class Request {
        @InvocableVariable(label='Account ID')
        public Id accountId;

        @InvocableVariable(label='Account Record')
        public Account accountRecord;

        @InvocableVariable(label='Related Contact IDs')
        public List<Id> relatedContactIds;

        @InvocableVariable(label='Requested Score')
        public Decimal requestedScore;

        @InvocableVariable(label='Urgent')
        public Boolean urgent;

        @InvocableVariable(label='Context')
        public String context;
    }

    /** Mixed output contract returned to Flow. */
    public class Result {
        @InvocableVariable(label='Account ID')
        public Id accountId;

        @InvocableVariable(label='Summary')
        public String summary;

        @InvocableVariable(label='Normalized Score')
        public Decimal normalizedScore;

        @InvocableVariable(label='Related Count')
        public Integer relatedCount;

        @InvocableVariable(label='Warnings')
        public List<String> warnings;

        @InvocableVariable(label='Succeeded')
        public Boolean succeeded;

        @InvocableVariable(label='Error Message')
        public String errorMessage;
    }

    /**
     * Produces exactly one result per request without SOQL or DML.
     * @param requests ordered Flow requests
     * @return ordered per-request results
     */
    @InvocableMethod(
        label='Build Complex Flow Result'
        description='Normalizes mixed scalar, record, and collection inputs into ordered per-request outputs.'
    )
    public static List<Result> buildResults(List<Request> requests) {
        List<Result> results = new List<Result>();
        if (requests == null) {
            return results;
        }
        for (Request request : requests) {
            results.add(buildResult(request));
        }
        return results;
    }

    private static Result buildResult(Request request) {
        Result result = new Result();
        result.warnings = new List<String>();
        try {
            requireRequest(request);
            result.accountId = accountId(request);
            result.normalizedScore = normalizedScore(request.requestedScore, result.warnings);
            result.relatedCount = relatedCount(request.relatedContactIds, result.warnings);
            result.summary = summary(request, result.relatedCount);
            result.succeeded = true;
        } catch (Exception error) {
            result.succeeded = false;
            result.errorMessage = error.getMessage();
        }
        return result;
    }

    private static void requireRequest(Request request) {
        if (request == null) {
            throw new IllegalArgumentException('Request is required.');
        }
        if (accountId(request) == null) {
            throw new IllegalArgumentException('Account ID or Account record is required.');
        }
    }

    private static Id accountId(Request request) {
        return request?.accountId != null ? request.accountId : request?.accountRecord?.Id;
    }

    private static Decimal normalizedScore(Decimal requested, List<String> warnings) {
        Decimal original = requested == null ? 0 : requested;
        Decimal normalized = Math.max(0, Math.min(100, original));
        if (normalized != original) {
            warnings.add('Score was constrained to the 0-100 range.');
        }
        return normalized;
    }

    private static Integer relatedCount(List<Id> relatedIds, List<String> warnings) {
        Integer count = relatedIds == null ? 0 : relatedIds.size();
        if (count == 0) {
            warnings.add('No related Contacts were supplied.');
        }
        return count;
    }

    private static String summary(Request request, Integer contactCount) {
        return String.join(
            new List<String>{
                String.isBlank(request.context) ? 'default' : request.context,
                String.isBlank(request.accountRecord?.Name) ? 'unnamed' : request.accountRecord.Name,
                'contacts=' + contactCount,
                'urgent=' + String.valueOf(request.urgent == true)
            },
            ';'
        );
    }
}
