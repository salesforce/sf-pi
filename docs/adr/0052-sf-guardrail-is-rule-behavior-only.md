# SF Guardrail is rule-behavior only

SF Guardrail no longer has bulk posture modes, hard-block themes, broad feature master switches, or an internal enabled flag. When the extension is enabled, mediation is controlled by per-rule Rule Behavior only: `off`, `confirm`, or `block`.

The complete disable path is the SF Pi package lifecycle control: disable the `sf-guardrail` extension from the Manager Surface or with `/sf-pi disable sf-guardrail`. This avoids the ambiguous state where the extension is loaded but a hidden internal switch makes it inert.

Rule-derived guidance is always injected once per session when SF Guardrail is enabled. There is no separate `promptInjection` preference. The guidance is generated from the effective rule set so it stays aligned with the actual Rule Behaviors.

**Consequences**

Users tune safety rule by rule in the Manager Settings Surface. Disabling a category means setting that category's rules to `Off`, not toggling a broad master switch. Approval timeout and protected org aliases remain routine Guardrail Preferences stored under `sfPi.guardrail`; headless behavior remains env-only via `SF_GUARDRAIL_ALLOW_HEADLESS`.

Legacy fields such as `enabled` and `features.*` are ignored by the effective configuration. Older bulk preset commands and UI actions are removed. Advanced Rule Overrides remain the expert mechanism for changing rule definitions, while Pi settings remain the routine mechanism for changing Rule Behavior.
