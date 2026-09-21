@IsTest
private class SfPiFlowAdvancedRuntimeTest {
    private static final String ACCOUNT_MARKER = 'SFPI-ADVANCED-BULK';

    @IsTest
    static void createsOneRelatedTaskThroughTheInvocableAction() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi Advanced Single',
                AccountNumber = ACCOUNT_MARKER
            );

            Test.startTest();
            insert account;
            Test.stopTest();

            List<Task> tasks = [
                SELECT WhatId, Subject, Description
                FROM Task
                WHERE WhatId = :account.Id
            ];
            Assert.areEqual(1, tasks.size(), 'The after-save Flow must create one related Task.');
            Assert.areEqual('SF Pi related review: SF Pi Advanced Single', tasks[0].Subject);
            Assert.isTrue(tasks[0].Description.contains('requestCount=1'));
            Assert.isTrue(tasks[0].Description.contains('requestIndex=0'));
            Assert.isTrue(tasks[0].Description.contains(String.valueOf(account.Id)));
        }
    }

    @IsTest
    static void bulkifiesTwoHundredInterviewsAndPreservesActionOutputOrder() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>();
            for (Integer index = 0; index < 200; index++) {
                accounts.add(new Account(
                    Name = 'SF Pi Advanced Bulk ' + index,
                    AccountNumber = ACCOUNT_MARKER
                ));
            }

            Test.startTest();
            insert accounts;
            Test.stopTest();

            Set<Id> accountIds = new Map<Id, Account>(accounts).keySet();
            List<Task> tasks = [
                SELECT WhatId, Subject, Description
                FROM Task
                WHERE WhatId IN :accountIds
            ];
            Assert.areEqual(200, tasks.size(), 'The Flow must create one related Task per Account.');

            Map<Id, Task> taskByAccountId = new Map<Id, Task>();
            Set<Integer> requestIndexes = new Set<Integer>();
            Pattern indexPattern = Pattern.compile('requestIndex=(\\d+);');
            for (Task task : tasks) {
                Assert.isFalse(taskByAccountId.containsKey(task.WhatId), 'Each Account must have one Task.');
                taskByAccountId.put(task.WhatId, task);
                Assert.isTrue(task.Description.contains('requestCount=200'));
                Assert.isTrue(task.Description.contains('recordKey=' + task.WhatId));
                Matcher matcher = indexPattern.matcher(task.Description);
                Assert.isTrue(matcher.find(), 'Each Task must expose its invocable request index.');
                requestIndexes.add(Integer.valueOf(matcher.group(1)));
            }

            Assert.areEqual(200, taskByAccountId.size());
            Assert.areEqual(200, requestIndexes.size(), 'Every ordered Apex output must map once.');
            for (Account account : accounts) {
                Task task = taskByAccountId.get(account.Id);
                Assert.isNotNull(task);
                Assert.areEqual('SF Pi related review: ' + account.Name, task.Subject);
            }
        }
    }
}
