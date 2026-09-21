@IsTest
private class SfPiFlowTransformRuntimeTest {
    @IsTest
    static void mapsContactFieldsToTaskOutput() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Map<String, Object> inputs = new Map<String, Object>{
                'inputContact' => new Contact(LastName = 'Zulu')
            };

            Test.startTest();
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Transform_Contact',
                inputs
            );
            interview.start();
            Test.stopTest();

            Task outputTask = (Task) interview.getVariableValue('outputTask');
            Assert.isNotNull(outputTask);
            Assert.areEqual('Zulu', outputTask.Subject);
        }
    }
}
