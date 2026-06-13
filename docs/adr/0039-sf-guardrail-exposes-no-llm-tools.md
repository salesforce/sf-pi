# SF Guardrail exposes no LLM tools

SF Guardrail will remain a mediator and command surface, not an LLM-callable tool provider. The extension should enforce safety through Pi Runtime tool-call mediation, human-in-the-loop dialogs, command panels, session entries, and settings rather than registering `sf_guardrail_*` tools that the agent can invoke directly.

This keeps the human as the authority for approvals and prevents agents from treating safety as a workflow they can operate or bypass. Commands such as `/sf-guardrail` may expose status, audit, settings, grants, and forget actions for users, but policy mutation and approval decisions should not become agent-callable tools.

**Consequences**

Future guardrail features should prefer event hooks, pi-native UI, and command surfaces. If a future LLM tool is proposed, it must prove why a command, HIL dialog, or existing Pi Runtime surface cannot satisfy the need without weakening the Safety Mediator posture.
