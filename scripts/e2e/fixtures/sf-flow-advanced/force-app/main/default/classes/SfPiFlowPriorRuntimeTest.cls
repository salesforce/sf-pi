@IsTest
private class SfPiFlowPriorRuntimeTest {
    @IsTest
    static void exposesPriorAndCurrentValuesDuringBeforeSaveUpdate() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi Advanced Prior Value',
                AccountNumber = 'SFPI-ADVANCED-PRIOR',
                Description = 'Before'
            );
            insert account;

            Test.startTest();
            account.Description = 'After';
            update account;
            Test.stopTest();

            Account updated = [SELECT Phone FROM Account WHERE Id = :account.Id];
            Assert.areEqual('prior=Before;current=After', updated.Phone);
        }
    }

    @IsTest
    static void exposesDistinctPriorValuesAcrossTwoHundredUpdates() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>();
            for (Integer index = 0; index < 200; index++) {
                accounts.add(new Account(
                    Name = 'SF Pi Prior Bulk ' + index,
                    AccountNumber = 'SFPI-ADVANCED-PRIOR',
                    Description = 'Before ' + index
                ));
            }
            insert accounts;

            for (Integer index = 0; index < accounts.size(); index++) {
                accounts[index].Description = 'After ' + index;
            }
            Test.startTest();
            update accounts;
            Test.stopTest();

            Map<Id, Account> updatedById = new Map<Id, Account>([
                SELECT Phone
                FROM Account
                WHERE Id IN :accounts
            ]);
            Assert.areEqual(200, updatedById.size());
            for (Integer index = 0; index < accounts.size(); index++) {
                Assert.areEqual(
                    'prior=Before ' + index + ';current=After ' + index,
                    updatedById.get(accounts[index].Id).Phone
                );
            }
        }
    }
}
