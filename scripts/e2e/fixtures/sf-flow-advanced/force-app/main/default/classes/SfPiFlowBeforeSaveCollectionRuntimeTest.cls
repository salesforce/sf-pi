@IsTest
private class SfPiFlowBeforeSaveCollectionRuntimeTest {
    @IsTest
    static void filtersAndSortsRelatedContactsBeforeSave() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(Name = 'SF Pi Before Collection');
            insert account;
            insert new List<Contact>{
                new Contact(AccountId = account.Id, LastName = 'Zulu', Email = 'z@example.test'),
                new Contact(AccountId = account.Id, LastName = 'Alpha', Email = 'a@example.test'),
                new Contact(AccountId = account.Id, LastName = 'Beta')
            };

            Test.startTest();
            account.AccountNumber = 'SFPI-ADVANCED-BEFORE-COLLECTION';
            update account;
            Test.stopTest();

            Account updated = [SELECT Phone FROM Account WHERE Id = :account.Id];
            Assert.areEqual('a@example.test', updated.Phone);
        }
    }

    @IsTest
    static void bulkifiesTwoHundredBeforeSaveCollections() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>();
            for (Integer index = 0; index < 200; index++) {
                accounts.add(new Account(Name = 'SF Pi Before Collection ' + index));
            }
            insert accounts;

            List<Contact> contacts = new List<Contact>();
            for (Integer index = 0; index < accounts.size(); index++) {
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'Zulu ' + index,
                    Email = 'z-' + index + '@example.test'
                ));
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'Alpha ' + index,
                    Email = 'a-' + index + '@example.test'
                ));
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'Beta ' + index
                ));
                accounts[index].AccountNumber = 'SFPI-ADVANCED-BEFORE-COLLECTION';
            }
            insert contacts;

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
                    'a-' + index + '@example.test',
                    updatedById.get(accounts[index].Id).Phone
                );
            }
        }
    }
}
