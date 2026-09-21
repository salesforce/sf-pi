/** Child Apex-defined value used to prove nested Flow Transform collections. */
public class SfPiFlowNestedChild {
    /** Public-safe value preserved by the nested Transform mapping. */
    @AuraEnabled
    public String value { get; set; }
}
