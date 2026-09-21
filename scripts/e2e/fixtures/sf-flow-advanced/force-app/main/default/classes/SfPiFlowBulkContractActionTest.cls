@IsTest
private class SfPiFlowBulkContractActionTest {
    @IsTest
    static void returnsOneOrderedResultForOneRequest() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPiFlowBulkContractAction.Request request = new SfPiFlowBulkContractAction.Request();
            request.recordKey = 'first';
            request.recordName = 'Alpha';

            Test.startTest();
            List<SfPiFlowBulkContractAction.Result> results =
                SfPiFlowBulkContractAction.buildTaskDetails(
                    new List<SfPiFlowBulkContractAction.Request>{ request }
                );
            Test.stopTest();

            Assert.areEqual(1, results.size(), 'The action must return one result per request.');
            Assert.areEqual(request.recordKey, results[0].recordKey, 'The result must preserve input order.');
            Assert.areEqual('SF Pi related review: Alpha', results[0].taskSubject);
            Assert.areEqual(1, results[0].requestCount);
            Assert.areEqual(0, results[0].requestIndex);
        }
    }

    @IsTest
    static void preservesSizeAndOrderForTwoHundredRequests() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<SfPiFlowBulkContractAction.Request> requests =
                new List<SfPiFlowBulkContractAction.Request>();
            for (Integer index = 0; index < 200; index++) {
                SfPiFlowBulkContractAction.Request request = new SfPiFlowBulkContractAction.Request();
                request.recordKey = 'key-' + index;
                request.recordName = 'Record ' + index;
                requests.add(request);
            }

            Test.startTest();
            List<SfPiFlowBulkContractAction.Result> results =
                SfPiFlowBulkContractAction.buildTaskDetails(requests);
            Test.stopTest();

            Assert.areEqual(requests.size(), results.size());
            for (Integer index = 0; index < requests.size(); index++) {
                Assert.areEqual(requests[index].recordKey, results[index].recordKey);
                Assert.areEqual('SF Pi related review: Record ' + index, results[index].taskSubject);
                Assert.areEqual(200, results[index].requestCount);
                Assert.areEqual(index, results[index].requestIndex);
                Assert.isTrue(results[index].succeeded);
                Assert.isNull(results[index].errorMessage);
            }
        }
    }

    @IsTest
    static void preservesCardinalityWhenIndividualRequestsAreInvalid() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            SfPiFlowBulkContractAction.Request valid = new SfPiFlowBulkContractAction.Request();
            valid.recordKey = 'valid';
            valid.recordName = 'Valid';
            SfPiFlowBulkContractAction.Request missingName =
                new SfPiFlowBulkContractAction.Request();
            missingName.recordKey = 'missing-name';

            List<SfPiFlowBulkContractAction.Result> results =
                SfPiFlowBulkContractAction.buildTaskDetails(
                    new List<SfPiFlowBulkContractAction.Request>{ valid, null, missingName }
                );

            Assert.areEqual(3, results.size());
            Assert.isTrue(results[0].succeeded);
            Assert.isNull(results[0].errorMessage);
            Assert.isFalse(results[1].succeeded);
            Assert.areEqual('Request is required.', results[1].errorMessage);
            Assert.isFalse(results[2].succeeded);
            Assert.areEqual('Record name is required.', results[2].errorMessage);
            for (Integer index = 0; index < results.size(); index++) {
                Assert.areEqual(3, results[index].requestCount);
                Assert.areEqual(index, results[index].requestIndex);
            }
        }
    }
}
