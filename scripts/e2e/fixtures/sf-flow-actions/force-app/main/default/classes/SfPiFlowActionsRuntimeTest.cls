@IsTest
private class SfPiFlowActionsRuntimeTest {
    /** Deterministic External Service and Named Credential response. */
    private class EchoMock implements HttpCalloutMock {
        /**
         * Returns a deterministic echo payload for both callout action types.
         * @param request outbound request
         * @return deterministic echo response
         */
        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            response.setStatusCode(200);
            response.setHeader('Content-Type', 'application/json');
            String marker = request.getEndpoint().substringAfter('marker=');
            response.setBody(
                '{"args":{"marker":"' + EncodingUtil.urlDecode(marker, 'UTF-8') + '"}}'
            );
            return response;
        }
    }

    @IsTest
    static void executesComplexApexContractThroughFlow() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(Name = 'SF Pi Complex Flow');
            insert account;
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Action_Complex_Apex',
                new Map<String, Object>{
                    'accountId' => account.Id,
                    'accountRecord' => account,
                    'context' => 'flow',
                    'relatedContactIds' => new List<String>{ UserInfo.getUserId(), account.Id },
                    'requestedScore' => 125,
                    'urgent' => true
                }
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Assert.areEqual(true, interview.getVariableValue('completed'));
            Assert.areEqual(true, interview.getVariableValue('succeeded'));
            Assert.areEqual(100, interview.getVariableValue('normalizedScore'));
            Assert.areEqual(2, interview.getVariableValue('relatedCount'));
            Assert.areEqual('flow;SF Pi Complex Flow;contacts=2;urgent=true', interview.getVariableValue('summary'));
            Assert.isNull(interview.getVariableValue('faultMessage'));
        }
    }

    @IsTest
    static void executesNamedCredentialBackedApexThroughFlow() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.setMock(HttpCalloutMock.class, new EchoMock());
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Action_Named_Credential',
                new Map<String, Object>{ 'marker' => 'named credential flow' }
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Assert.areEqual(true, interview.getVariableValue('completed'));
            Assert.areEqual(true, interview.getVariableValue('succeeded'));
            Assert.areEqual(200, interview.getVariableValue('statusCode'));
            Assert.areEqual('named credential flow', interview.getVariableValue('echoedMarker'));
            Assert.isNull(interview.getVariableValue('faultMessage'));
        }
    }

    @IsTest
    static void executesExternalServiceThroughFlow() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.setMock(HttpCalloutMock.class, new EchoMock());
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Action_External_Service',
                new Map<String, Object>{ 'marker' => 'external service flow' }
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Assert.areEqual(true, interview.getVariableValue('completed'));
            Assert.areEqual(200, interview.getVariableValue('responseCode'));
            Assert.isNull(interview.getVariableValue('faultMessage'));
        }
    }

    @IsTest
    static void executesQuickActionAndEmailAlertThroughFlow() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(Name = 'SF Pi Quick and Email Actions');
            insert account;
            Flow.Interview quickAction = Flow.Interview.createInterview(
                'SfPi_Action_Quick_Action',
                new Map<String, Object>{ 'accountId' => account.Id }
            );
            Flow.Interview emailAlert = Flow.Interview.createInterview(
                'SfPi_Action_Email_Alert',
                new Map<String, Object>{ 'accountId' => account.Id }
            );

            Test.startTest();
            quickAction.start();
            emailAlert.start();
            Test.stopTest();

            Assert.areEqual(true, quickAction.getVariableValue('completed'));
            Assert.isNull(quickAction.getVariableValue('faultMessage'));
            Assert.areEqual(true, emailAlert.getVariableValue('completed'));
            Assert.isNull(emailAlert.getVariableValue('faultMessage'));
            List<Task> tasks = [
                SELECT Subject, WhatId
                FROM Task
                WHERE WhatId = :account.Id AND Subject = 'SFPI Quick Action follow-up'
            ];
            Assert.areEqual(1, tasks.size());
        }
    }
}
