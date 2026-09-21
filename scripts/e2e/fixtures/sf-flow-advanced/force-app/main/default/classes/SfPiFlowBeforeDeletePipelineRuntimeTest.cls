@IsTest
private class SfPiFlowBeforeDeletePipelineRuntimeTest {
    private static final String ACCOUNT_MARKER = 'SFPI-ADVANCED-DELETE';

    @IsTest
    static void processesRelatedRecordsBeforeSingleDelete() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Account account = new Account(
                Name = 'SF Pi Delete Single',
                AccountNumber = ACCOUNT_MARKER
            );
            insert account;
            insert new List<Contact>{
                new Contact(AccountId = account.Id, LastName = 'SFPI Delete Zulu', Email = 'z@example.test'),
                new Contact(AccountId = account.Id, LastName = 'SFPI Delete Alpha', Email = 'a@example.test'),
                new Contact(AccountId = account.Id, LastName = 'SFPI Delete Ignored')
            };

            Test.startTest();
            delete account;
            Test.stopTest();

            List<Task> tasks = [
                SELECT Subject, Description
                FROM Task
                WHERE Subject LIKE 'SFPI Delete %'
                ORDER BY Subject
            ];
            Assert.areEqual(2, tasks.size());
            Assert.areEqual('SFPI Delete Alpha', tasks[0].Subject);
            Assert.areEqual('SFPI Delete Zulu', tasks[1].Subject);
            Assert.isTrue(tasks[0].Description.contains('requestCount=1'));
            Assert.isTrue(tasks[0].Description.contains('requestIndex=0'));
            Assert.isTrue(tasks[0].Description.contains(String.valueOf(account.Id)));
        }
    }

    @IsTest
    static void bulkifiesTwoHundredBeforeDeletePipelines() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Account> accounts = new List<Account>();
            for (Integer index = 0; index < 200; index++) {
                accounts.add(new Account(
                    Name = 'SF Pi Delete Bulk ' + index,
                    AccountNumber = ACCOUNT_MARKER
                ));
            }
            insert accounts;

            List<Contact> contacts = new List<Contact>();
            for (Integer index = 0; index < accounts.size(); index++) {
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'SFPI Delete ' + index,
                    Email = 'delete-' + index + '@example.test'
                ));
                contacts.add(new Contact(
                    AccountId = accounts[index].Id,
                    LastName = 'SFPI Delete Ignored ' + index
                ));
            }
            insert contacts;

            Test.startTest();
            delete accounts;
            Test.stopTest();

            List<Task> tasks = [
                SELECT Subject, Description
                FROM Task
                WHERE Subject LIKE 'SFPI Delete %'
            ];
            Assert.areEqual(200, tasks.size());
            Set<String> recordKeys = new Set<String>();
            Set<Integer> requestIndexes = new Set<Integer>();
            Pattern keyPattern = Pattern.compile('recordKey=([^;]+)$');
            Pattern indexPattern = Pattern.compile('requestIndex=(\\d+);');
            for (Task task : tasks) {
                Assert.isTrue(task.Description.contains('requestCount=200'));
                Matcher keyMatcher = keyPattern.matcher(task.Description);
                Matcher indexMatcher = indexPattern.matcher(task.Description);
                Assert.isTrue(keyMatcher.find());
                Assert.isTrue(indexMatcher.find());
                recordKeys.add(keyMatcher.group(1));
                requestIndexes.add(Integer.valueOf(indexMatcher.group(1)));
            }
            Assert.areEqual(200, recordKeys.size());
            Assert.areEqual(200, requestIndexes.size());
        }
    }
}
