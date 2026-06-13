# SF Guardrail defers project-local rule overrides

SF Guardrail will defer project-local rule overrides until after the Safety Kernel and Approval Ledger refactor. The current redesign should first simplify the decision and approval seams before adding another configuration layer such as `.pi/sf-guardrail/rules.json`.

Project-local overrides are powerful but risky because they can become repo-shared bypasses if they are not clearly gated, visible, and subordinate to the Safety Mediator posture. If introduced later, they must require trusted project context, be visible in `/sf-guardrail` status surfaces, merge predictably with bundled and user preferences, and never silently weaken hard-blocked safety boundaries.

**Consequences**

Near-term work should focus on kernel, ledger, rule-derived guidance, and pi-native preferences. Project-local overrides remain an advanced follow-up and need a fresh design review before implementation.
