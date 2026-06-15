# SF Guardrail settings use a section chooser

> Superseded by ADR 0049. The section chooser was the interim extension-owned settings surface; routine preferences now live in Pi settings and are edited from the SF Pi Manager config panel.

`/sf-guardrail settings` will open with a section chooser rather than a long flat rule list. Users choose an intent-oriented section first, then review focused settings with examples and descriptions.

This keeps the Guardrail Settings Surface self-serving for end users while preserving the descriptor-driven implementation needed for future reuse by SF Pi Manager or a future Pi extension-settings seam.

**Consequences**

The settings UI should group rules by user intent, not implementation type alone. Each section should provide examples and explain what off, confirm, and hard block mean in context. The old flat `SettingsList` may remain as an internal adapter, but it should not be the first screen users see.
