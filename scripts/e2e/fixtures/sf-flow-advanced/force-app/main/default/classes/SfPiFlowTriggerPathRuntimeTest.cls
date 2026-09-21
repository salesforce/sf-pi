@IsTest
private class SfPiFlowTriggerPathRuntimeTest {
    @IsTest
    static void runsCreateAndUpdateTriggerConfiguration() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi Create and Update',
                AccountNumber = 'SFPI-ADVANCED-CREATE-UPDATE'
            );

            Test.startTest();
            insert account;
            Account created = [SELECT Description FROM Account WHERE Id = :account.Id];
            Assert.areEqual('SFPI create-update trigger fired', created.Description);
            account.Description = null;
            account.Name = 'SF Pi Create and Update Again';
            update account;
            Test.stopTest();

            Account updated = [SELECT Description FROM Account WHERE Id = :account.Id];
            Assert.areEqual('SFPI create-update trigger fired', updated.Description);
        }
    }

    @IsTest
    static void runsImmediateRelatedUpdateAndAsyncAfterCommitPath() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi Related and Async',
                AccountNumber = 'SFPI-ADVANCED-PATHS-PENDING'
            );
            insert account;
            Contact contact = new Contact(AccountId = account.Id, LastName = 'Async Contact');
            insert contact;

            Test.startTest();
            account.Name = 'SF Pi Related and Async Updated';
            account.AccountNumber = 'SFPI-ADVANCED-PATHS';
            update account;
            Contact updatedContact = [SELECT Description FROM Contact WHERE Id = :contact.Id];
            Assert.areEqual('SFPI synchronous related update', updatedContact.Description);
            Test.stopTest();
        }
    }
}
