@IsTest
private class SfPiFlowCollectionRuntimeTest {
    @IsTest
    static void filtersSortsAndLimitsContactCollection() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Contact> inputContacts = new List<Contact>{
                new Contact(LastName = 'Zulu', Email = 'zulu@example.test'),
                new Contact(LastName = 'Alpha', Email = 'alpha@example.test'),
                new Contact(LastName = 'Beta'),
                new Contact(LastName = 'Gamma', Email = 'gamma@example.test')
            };
            Map<String, Object> inputs = new Map<String, Object>{
                'inputContacts' => inputContacts
            };

            Test.startTest();
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Filter_Sort_Contacts',
                inputs
            );
            interview.start();
            Test.stopTest();

            List<Contact> outputContacts =
                (List<Contact>) interview.getVariableValue('outputContacts');
            Assert.areEqual(2, outputContacts.size());
            Assert.areEqual('Alpha', outputContacts[0].LastName);
            Assert.areEqual('Gamma', outputContacts[1].LastName);
            Assert.areEqual('alpha@example.test', outputContacts[0].Email);
            Assert.areEqual('gamma@example.test', outputContacts[1].Email);
            Assert.areEqual('Zulu', inputContacts[0].LastName, 'Filtering must not reorder the source.');
            Assert.areEqual('Alpha', inputContacts[1].LastName, 'Filtering must not reorder the source.');
        }
    }

    @IsTest
    static void returnsAnEmptyCollectionWhenNothingMatches() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Map<String, Object> inputs = new Map<String, Object>{
                'inputContacts' => new List<Contact>{
                    new Contact(LastName = 'No Email One'),
                    new Contact(LastName = 'No Email Two')
                }
            };

            Test.startTest();
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Filter_Sort_Contacts',
                inputs
            );
            interview.start();
            Test.stopTest();

            List<Contact> outputContacts =
                (List<Contact>) interview.getVariableValue('outputContacts');
            Assert.isNotNull(outputContacts);
            Assert.areEqual(0, outputContacts.size());
        }
    }
}
