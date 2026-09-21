@IsTest
private class SfPiFlowAfterSavePriorRuntimeTest {
    @IsTest
    static void createsRelatedEvidenceFromPriorAndCurrentValues() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi After Save Prior',
                AccountNumber = 'SFPI-ADVANCED-PRIOR-AFTER',
                Description = 'Before'
            );
            insert account;

            Test.startTest();
            account.Description = 'After';
            update account;
            Test.stopTest();

            Task task = [SELECT WhatId, Subject FROM Task WHERE WhatId = :account.Id LIMIT 1];
            Assert.areEqual(account.Id, task.WhatId);
            Assert.areEqual('prior=Before;current=After', task.Subject);
        }
    }

    @IsTest
    static void preservesPriorValuesAcrossTwoHundredAfterSaveUpdates() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>();
            for (Integer index = 0; index < 200; index++) {
                accounts.add(new Account(
                    Name = 'SF Pi After Prior Bulk ' + index,
                    AccountNumber = 'SFPI-ADVANCED-PRIOR-AFTER',
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

            Set<Id> accountIds = new Map<Id, Account>(accounts).keySet();
            Map<Id, Task> taskByAccountId = new Map<Id, Task>();
            for (Task task : [SELECT WhatId, Subject FROM Task WHERE WhatId IN :accountIds]) {
                Assert.isFalse(taskByAccountId.containsKey(task.WhatId));
                taskByAccountId.put(task.WhatId, task);
            }
            Assert.areEqual(200, taskByAccountId.size());
            for (Integer index = 0; index < accounts.size(); index++) {
                Assert.areEqual(
                    'prior=Before ' + index + ';current=After ' + index,
                    taskByAccountId.get(accounts[index].Id).Subject
                );
            }
        }
    }
}
