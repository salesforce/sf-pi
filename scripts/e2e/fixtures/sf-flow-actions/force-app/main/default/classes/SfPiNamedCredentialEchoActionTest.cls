@IsTest
private class SfPiNamedCredentialEchoActionTest {
    /** Deterministic Named Credential response. */
    private class EchoMock implements HttpCalloutMock {
        /**
         * Returns a deterministic echo payload for the Named Credential callout.
         * @param request outbound request
         * @return deterministic echo response
         */
        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            response.setStatusCode(200);
            String marker = request.getEndpoint().substringAfter('marker=');
            response.setBody('{"args":{"marker":"' + EncodingUtil.urlDecode(marker, 'UTF-8') + '"}}');
            return response;
        }
    }

    @IsTest
    static void callsNamedCredentialAndPreservesOrder() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.setMock(HttpCalloutMock.class, new EchoMock());
            List<SfPiNamedCredentialEchoAction.Request> requests = new List<SfPiNamedCredentialEchoAction.Request>();
            for (String marker : new List<String>{ 'first marker', 'second marker' }) {
                SfPiNamedCredentialEchoAction.Request request = new SfPiNamedCredentialEchoAction.Request();
                request.marker = marker;
                requests.add(request);
            }

            Test.startTest();
            List<SfPiNamedCredentialEchoAction.Result> results = SfPiNamedCredentialEchoAction.echo(
                requests
            );
            Test.stopTest();

            Assert.areEqual(2, results.size());
            Assert.areEqual('first marker', results[0].echoedMarker);
            Assert.areEqual('second marker', results[1].echoedMarker);
            Assert.isTrue(results[0].succeeded);
            Assert.isTrue(results[1].succeeded);
        }
    }

    @IsTest
    static void returnsPerItemValidationErrorsWithoutCallout() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPiNamedCredentialEchoAction.Request request = new SfPiNamedCredentialEchoAction.Request();

            Test.startTest();
            List<SfPiNamedCredentialEchoAction.Result> results = SfPiNamedCredentialEchoAction.echo(
                new List<SfPiNamedCredentialEchoAction.Request>{ request }
            );
            Test.stopTest();

            Assert.areEqual(1, results.size());
            Assert.isFalse(results[0].succeeded);
            Assert.isTrue(results[0].errorMessage.contains('required'));
        }
    }
}
