@IsTest
private class SfPiFlowRelatedPipelineRuntimeTest {
    @IsTest
    static void processesRelatedRecordsThroughSubflowCollectionAndTransform() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(Name = 'SF Pi Related Pipeline');
            insert account;
            insert new List<Contact>{
                new Contact(AccountId = account.Id, LastName = 'Zulu', Email = 'zulu@example.test'),
                new Contact(AccountId = account.Id, LastName = 'Alpha', Email = 'alpha@example.test'),
                new Contact(AccountId = account.Id, LastName = 'Beta')
            };

            Test.startTest();
            account.AccountNumber = 'SFPI-ADVANCED-PIPELINE';
            update account;
            Test.stopTest();

            List<Task> tasks = [
                SELECT WhatId, Subject, Description
                FROM Task
                WHERE WhatId = :account.Id
                ORDER BY Subject
            ];
            Assert.areEqual(2, tasks.size());
            Assert.areEqual('Alpha', tasks[0].Subject);
            Assert.areEqual('Zulu', tasks[1].Subject);
            Assert.areEqual('alpha@example.test', tasks[0].Description);
            Assert.areEqual('zulu@example.test', tasks[1].Description);
        }
    }

    @IsTest
    static void bulkifiesRelatedLookupSubflowCollectionTransformAndCreate() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>();
            for (Integer index = 0; index < 200; index++) {
                accounts.add(new Account(Name = 'SF Pi Pipeline Bulk ' + index));
            }
            insert accounts;

            List<Contact> contacts = new List<Contact>();
            for (Integer index = 0; index < accounts.size(); index++) {
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'Zulu ' + index,
                    Email = 'zulu-' + index + '@example.test'
                ));
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'Alpha ' + index,
                    Email = 'alpha-' + index + '@example.test'
                ));
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'Beta ' + index
                ));
                accounts[index].AccountNumber = 'SFPI-ADVANCED-PIPELINE';
            }

            insert contacts;
            Test.startTest();
            update accounts;
            Test.stopTest();

            Set<Id> accountIds = new Map<Id, Account>(accounts).keySet();
            List<Task> tasks = [
                SELECT WhatId, Subject, Description
                FROM Task
                WHERE WhatId IN :accountIds
            ];
            Assert.areEqual(400, tasks.size(), 'Each Account must receive two transformed Tasks.');

            Map<Id, Integer> taskCountByAccount = new Map<Id, Integer>();
            for (Task task : tasks) {
                taskCountByAccount.put(
                    task.WhatId,
                    (taskCountByAccount.containsKey(task.WhatId) ? taskCountByAccount.get(task.WhatId) : 0) + 1
                );
                Assert.isFalse(task.Subject.startsWith('Beta '));
                Assert.isNotNull(task.Description);
            }
            Assert.areEqual(200, taskCountByAccount.size());
            for (Id accountId : accountIds) {
                Assert.areEqual(2, taskCountByAccount.get(accountId));
            }
        }
    }
}
