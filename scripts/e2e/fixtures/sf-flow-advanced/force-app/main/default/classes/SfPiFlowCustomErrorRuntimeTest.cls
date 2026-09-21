@IsTest
private class SfPiFlowCustomErrorRuntimeTest {
    @IsTest
    static void rollsBackRejectedRecordAndAllowsValidRecord() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>{
                new Account(Name = 'SFPI Reject Invalid', AccountNumber = 'SFPI-ADVANCED-CUSTOM-ERROR'),
                new Account(Name = 'SFPI Accept Valid', AccountNumber = 'SFPI-ADVANCED-CUSTOM-ERROR')
            };

            Test.startTest();
            List<Database.SaveResult> results = Database.insert(accounts, false);
            Test.stopTest();

            Assert.isFalse(results[0].isSuccess());
            Assert.isTrue(
                results[0].getErrors()[0].getMessage().contains('SFPI custom error rejected this Account.')
            );
            Assert.isTrue(results[1].isSuccess());
            Account accepted = [SELECT Description FROM Account WHERE Id = :results[1].getId()];
            Assert.areEqual('SFPI custom error validation passed', accepted.Description);
        }
    }
}
