@IsTest
private class SfPiComplexFlowActionTest {
    @IsTest
    static void mapsMixedInputTypesAndWarnings() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPiComplexFlowAction.Request request = new SfPiComplexFlowAction.Request();
            request.accountId = UserInfo.getUserId();
            request.accountRecord = new Account(Name = 'SF Pi Complex Account');
            request.relatedContactIds = new List<Id>{ UserInfo.getUserId(), UserInfo.getUserId() };
            request.requestedScore = 125;
            request.urgent = true;
            request.context = 'runtime';

            Test.startTest();
            List<SfPiComplexFlowAction.Result> results = SfPiComplexFlowAction.buildResults(
                new List<SfPiComplexFlowAction.Request>{ request }
            );
            Test.stopTest();

            Assert.areEqual(1, results.size());
            Assert.isTrue(results[0].succeeded);
            Assert.areEqual(100, results[0].normalizedScore);
            Assert.areEqual(2, results[0].relatedCount);
            Assert.areEqual(1, results[0].warnings.size());
            Assert.areEqual('runtime;SF Pi Complex Account;contacts=2;urgent=true', results[0].summary);
        }
    }

    @IsTest
    static void preservesTwoHundredOrderedResultsAndPerItemErrors() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<SfPiComplexFlowAction.Request> requests = new List<SfPiComplexFlowAction.Request>();
            for (Integer index = 0; index < 199; index++) {
                SfPiComplexFlowAction.Request request = new SfPiComplexFlowAction.Request();
                request.accountId = UserInfo.getUserId();
                request.accountRecord = new Account(Name = 'Account ' + index);
                request.requestedScore = index;
                request.context = 'item-' + index;
                requests.add(request);
            }
            requests.add(new SfPiComplexFlowAction.Request());

            Test.startTest();
            List<SfPiComplexFlowAction.Result> results = SfPiComplexFlowAction.buildResults(requests);
            Test.stopTest();

            Assert.areEqual(200, results.size());
            for (Integer index = 0; index < 199; index++) {
                Assert.isTrue(results[index].succeeded);
                Assert.isTrue(results[index].summary.startsWith('item-' + index + ';Account ' + index));
            }
            Assert.isFalse(results[199].succeeded);
            Assert.isTrue(results[199].errorMessage.contains('required'));
        }
    }
}
