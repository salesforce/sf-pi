@IsTest
private class SfPiFlowDataElementRuntimeTest {
    @IsTest
    static void executesGetCreateUpdateAndDeleteInOneInterview() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi Data Operations',
                AccountNumber = 'SFPI-ADVANCED-DATA-OPS'
            );
            insert account;
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Data_Operations',
                new Map<String, Object>()
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Account updated = [SELECT Description FROM Account WHERE Id = :account.Id];
            Assert.areEqual('SFPI data operations updated', updated.Description);
            Assert.areEqual(0, [SELECT COUNT() FROM Contact WHERE AccountId = :account.Id]);
            Assert.areEqual(true, interview.getVariableValue('completed'));
            Assert.isNull(interview.getVariableValue('faultMessage'));
        }
    }

    @IsTest
    static void returnsNotFoundWithoutAttemptingMutations() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Data_Operations',
                new Map<String, Object>()
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Assert.isNull(interview.getVariableValue('completed'));
            Assert.areEqual('Account not found', interview.getVariableValue('faultMessage'));
        }
    }
}
