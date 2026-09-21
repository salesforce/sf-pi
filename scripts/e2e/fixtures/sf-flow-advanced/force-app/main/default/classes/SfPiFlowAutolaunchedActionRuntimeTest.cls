@IsTest
private class SfPiFlowAutolaunchedActionRuntimeTest {
    @IsTest
    static void mapsInvocableInputsAndOutputsInAutolaunchedFlow() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Map<String, Object> inputs = new Map<String, Object>{
                'inputKey' => 'autolaunched-key',
                'inputName' => 'Autolaunched'
            };

            Test.startTest();
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Autolaunched_Action',
                inputs
            );
            interview.start();
            Test.stopTest();

            Assert.areEqual('autolaunched-key', interview.getVariableValue('outputKey'));
            Assert.areEqual(
                'SF Pi related review: Autolaunched',
                interview.getVariableValue('outputSubject')
            );
            Assert.areEqual(1, interview.getVariableValue('outputCount'));
            Assert.areEqual(0, interview.getVariableValue('outputIndex'));
        }
    }
}
