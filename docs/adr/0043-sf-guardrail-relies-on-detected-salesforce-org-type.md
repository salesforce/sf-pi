# SF Guardrail relies on detected Salesforce org type

SF Guardrail will keep org classification simple and rely on the Salesforce org facts already available through `@salesforce/core` and the SF Pi environment cache. It will not add a separate demo-org taxonomy or broad non-production alias lists to reduce prompts.

The supported posture is: use detected `scratch`, `sandbox`, `developer`, `trial`, or `production` when the org can be resolved; treat unresolved or unknown orgs as production for risky operations. Users may still explicitly mark aliases as production, but sf-guardrail should not grow a parallel classification system for demo/dev/training labels.

**Consequences**

Prompt fatigue should be reduced through session-scoped Safety Envelope approvals, not by adding more org-category configuration. Future org-classification work should improve detection from Salesforce/Core data before adding new user-maintained classification knobs.
