---
status: superseded by ADR-0046
---

# SF Guardrail hard-block themes start with two presets

SF Guardrail considered starting with two hard-block themes: Power Tool and Strict. Power Tool is the default and makes risky actions human-confirmable. Strict is opt-in and turns selected sensitive categories into non-overridable hard blocks.

This keeps the product simple while still supporting users or teams that want stronger local refusal behavior. We are deliberately not adding a Balanced theme or a broader policy matrix until real usage shows that two presets are insufficient.

**Consequences**

Superseded by ADR-0046: themes are convenience presets only, while the underlying configuration is per-rule behavior: off, confirm, or hard block.
