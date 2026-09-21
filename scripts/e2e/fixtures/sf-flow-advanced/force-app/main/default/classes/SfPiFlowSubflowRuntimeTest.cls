@IsTest
private class SfPiFlowSubflowRuntimeTest {
    @IsTest
    static void passesPrimitiveAndRecordCollectionInputsAndOutputs() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            List<Contact> inputContacts = new List<Contact>{
                new Contact(LastName = 'First'),
                new Contact(LastName = 'Second')
            };
            Map<String, Object> inputs = new Map<String, Object>{
                'inputText' => 'from parent',
                'inputContacts' => inputContacts
            };

            Test.startTest();
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Subflow_Parent',
                inputs
            );
            interview.start();
            Test.stopTest();

            Assert.areEqual('from parent', interview.getVariableValue('outputText'));
            List<Contact> outputContacts =
                (List<Contact>) interview.getVariableValue('outputContacts');
            Assert.areEqual(2, outputContacts.size());
            Assert.areEqual('First', outputContacts[0].LastName);
            Assert.areEqual('Second', outputContacts[1].LastName);
        }
    }
}
