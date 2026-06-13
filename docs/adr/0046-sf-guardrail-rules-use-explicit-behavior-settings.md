# SF Guardrail rules use explicit behavior settings

SF Guardrail rules will use explicit per-rule behavior settings: off, confirm, or hard block. Confirm is the default power-tool posture for risky actions; hard block is an opt-in refusal for specific rules; off disables the rule.

Hard-block themes such as Power Tool or Strict are convenience presets only. They may set many rule behaviors at once, but they are not the underlying configuration model. Users must be able to inspect and adjust individual rules from settings after applying any preset.

**Consequences**

Settings should expose rule behavior as off / confirm / hard block rather than a simple on/off toggle. Existing `enabled` booleans should be treated as compatibility input and migrated or interpreted into behavior settings. HIL copy remains the primary safety path for confirm rules.
