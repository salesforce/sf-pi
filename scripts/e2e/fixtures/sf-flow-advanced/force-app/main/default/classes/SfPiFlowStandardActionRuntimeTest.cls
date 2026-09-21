@IsTest
private class SfPiFlowStandardActionRuntimeTest {
    @IsTest
    static void executesStandardSendEmailActionWithoutFault() {
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Flow.Interview interview = Flow.Interview.createInterview(
                'SfPi_Advanced_Email_Action',
                new Map<String, Object>{ 'recipientEmail' => UserInfo.getUserEmail() }
            );

            Test.startTest();
            interview.start();
            Test.stopTest();

            Assert.areEqual(true, interview.getVariableValue('completed'));
            Assert.isNull(interview.getVariableValue('faultMessage'));
        }
    }
}
