# SF Guardrail uses pi-native preferences with advanced rule overrides

> Superseded in part by ADR 0049. Routine preferences still use pi-native settings, but the primary mutable surface is now the SF Pi Manager config panel rather than `/sf-guardrail settings`.

SF Guardrail will expose normal user-facing preferences through pi-native settings and UI surfaces, while keeping advanced JSON rule overrides for uncommon cases that need custom file policies, custom dangerous-command patterns, or full replacement of a bundled rule by stable id. Common controls such as feature toggles, confirmation timeout, production aliases, and bundled-rule enablement should not require hand-editing JSON.

This preserves power without turning SF Guardrail into a policy engine. Pi-native settings and shared SF Pi command panels reduce custom code, make behavior easier to discover, and keep routine configuration in the same place users expect other SF Pi preferences to live.

**Consequences**

`/sf-guardrail settings` should become the primary configuration path for common preferences. Existing advanced override files may remain supported, but they should be treated as an expert escape hatch rather than the main UX. Project-local rule overrides, if added later, must respect Pi project trust and remain subordinate to the Safety Mediator posture from ADR 0033.
