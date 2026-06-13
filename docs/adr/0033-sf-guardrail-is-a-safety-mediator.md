# SF Guardrail is a safety mediator, not a policy engine

SF Guardrail will remain an opinionated Salesforce-aware safety mediator that turns risky agent actions into allow, block, or human-approval decisions. We will support narrow tuning and advanced overrides where they reduce repeated friction, but we will not grow the extension into a general-purpose policy engine, governance framework, shell sandbox, or security scanner.

**Considered Options**

- Safety mediator: smaller surface, clearer agent behavior, less custom code, and stronger fail-closed semantics.
- Configurable policy engine: more flexible, but creates a larger rule language, more UI/config burden, more drift between docs/prompts/rules, and higher risk of unsafe or confusing bypasses.

**Consequences**

Future sf-guardrail work should prefer pi-native confirmation, session state, settings, and panels over custom infrastructure. New features must justify themselves as narrow safety mediation; broad policy authoring, generic scanning, and sandboxing belong outside this extension.
