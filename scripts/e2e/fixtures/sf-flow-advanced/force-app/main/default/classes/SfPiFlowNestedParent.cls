/** Parent Apex-defined value used to prove nested Flow Transform collections. */
public class SfPiFlowNestedParent {
    /** Parent label preserved by the outer collection mapping. */
    @AuraEnabled
    public String label { get; set; }

    /** Child collection preserved by the second collection level. */
    @AuraEnabled
    public List<SfPiFlowNestedChild> children { get; set; }
}
