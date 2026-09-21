@IsTest
private class SfPiFlowPlatformEventRuntimeTest {
    @IsTest
    static void invokesApexForOnePlatformEvent() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Test.startTest();
            Database.SaveResult result = EventBus.publish(
                new SfPi_Advanced_Event__e(Message__c = 'PE single')
            );
            Assert.isTrue(result.isSuccess());
            Test.getEventBus().deliver();
            Test.stopTest();

            Task task = [
                SELECT Subject, Description
                FROM Task
                WHERE Subject = 'SF Pi related review: PE single'
                LIMIT 1
            ];
            Assert.areEqual('SF Pi related review: PE single', task.Subject);
            Assert.isTrue(task.Description.contains('requestCount=1'));
            Assert.isTrue(task.Description.contains('requestIndex=0'));
            Assert.isTrue(task.Description.endsWith('recordKey=PE single'));
        }
    }

    @IsTest
    static void bulkifiesTwoHundredPlatformEventsAndPreservesOutputOrder() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<SfPi_Advanced_Event__e> events = new List<SfPi_Advanced_Event__e>();
            for (Integer index = 0; index < 200; index++) {
                events.add(new SfPi_Advanced_Event__e(Message__c = 'PE ' + index));
            }

            Test.startTest();
            List<Database.SaveResult> results = EventBus.publish(events);
            for (Database.SaveResult result : results) {
                Assert.isTrue(result.isSuccess());
            }
            Test.getEventBus().deliver();
            Test.stopTest();

            List<Task> tasks = [
                SELECT Subject, Description
                FROM Task
                WHERE Subject LIKE 'SF Pi related review: PE %'
            ];
            Assert.areEqual(200, tasks.size());
            Set<String> recordKeys = new Set<String>();
            Set<Integer> requestIndexes = new Set<Integer>();
            Pattern keyPattern = Pattern.compile('recordKey=(PE \\d+)$');
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
