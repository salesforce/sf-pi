# Context Map

## Contexts

- [SF Pi](./CONTEXT.md) — the bundled Salesforce-focused extension suite for pi.
- [SF Guardrail](./extensions/sf-guardrail/CONTEXT.md) — the safety context for mediating risky agent actions in SF Pi.
- [SF Ohana Spinner](./extensions/sf-ohana-spinner/CONTEXT.md) — the lightweight waiting-state companion for active agent turns.

## Relationships

- **SF Pi → SF Guardrail**: SF Pi bundles Guardrail as the safety mediator for risky agent actions.
- **SF Guardrail → SF Pi**: Guardrail follows SF Pi extension conventions and uses Pi Runtime surfaces for decisions, approvals, and audit state.
- **SF Pi → SF Ohana Spinner**: SF Pi bundles the spinner as one optional extension in the suite.
- **SF Ohana Spinner → SF Pi**: The spinner follows SF Pi's extension conventions and is discoverable through the shared manager surface.
