# SF Guardrail uses rule-derived guidance

SF Guardrail will derive the agent-visible guardrail guidance from the effective ruleset and runtime config instead of maintaining a separate policy prompt as an independent source of truth. Hand-authored prose should stay minimal and generic; the active file protections, dangerous-command gates, org-aware gates, headless behavior, and safer rehearsal hints should come from the same data the Safety Kernel evaluates.

This prevents drift between bundled defaults, override behavior, command-panel output, README prose, tests, and the hidden guidance sent to agents. The guidance remains a compact explanation for agent behavior, not a second rule language and not a replacement for the Safety Kernel.

**Consequences**

Rule changes must update the effective ruleset and tests first. Prompt rendering should be deterministic, compact, and public-safe. If an advanced override changes active behavior, the generated guidance and `/sf-guardrail` status surfaces should reflect that behavior without requiring a separate prompt edit.
