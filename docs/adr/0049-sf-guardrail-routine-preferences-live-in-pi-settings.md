# SF Guardrail routine preferences live in Pi settings

SF Guardrail routine preferences now live in Pi's native settings file under `sfPi.guardrail`. The SF Pi Manager config surface is the primary mutable UI for these preferences. `/sf-guardrail settings` remains as a compatibility/help entrypoint that points users to the manager surface instead of opening an extension-owned settings editor.

Routine preferences include feature toggles, confirmation timeout, production aliases, and bundled-rule behavior values (`off`, `confirm`, `block`). Advanced rule overrides remain in `~/.pi/agent/sf-guardrail/rules.json` and are reserved for custom file policies, custom command patterns, custom org-aware rules, or full bundled-rule replacement by stable id.

This supersedes the earlier direction that `/sf-guardrail settings` should own the primary mutable settings flow. The sectioned settings chooser was useful as an interim surface, but it duplicated Pi/manager navigation semantics and mixed routine preference writes with the advanced override file. Moving routine settings to Pi settings keeps the storage model consistent with other user-facing Pi preferences and avoids maintaining a bespoke settings editor for normal use.

Project-local guardrail preference weakening remains deferred. A repository should not be able to silently weaken a user's safety posture through committed project settings. Any future project-local guardrail preference layer needs a separate trust-aware design and ADR.

**Consequences**

`loadConfig()` resolves the effective config from bundled defaults, the advanced rule override file, and Pi settings. Pi settings win for routine preferences so the manager UI reflects the behavior the runtime will use. The advanced override file is still read for compatibility and expert customization, but routine preference writers should not create or mutate it.

The SF Pi Manager config panel becomes the normal place to inspect and change Guardrail Preferences. `/sf-guardrail` stays focused on safety mediation: status, effective rules, audit, approval grants, and approval revocation. Preset actions write compact rule behavior settings instead of copying the bundled rule file.

The Guardrail Settings Surface uses nested pages instead of one flat list: a settings home page links to Safety posture, Core controls, File protection rules, Dangerous command rules, Salesforce org operation rules, Production aliases, and Advanced Rule Overrides. Rule pages render one row per effective rule id, including custom rules from the advanced override file, so advanced users can map the UI back to JSON while routine behavior changes still save to Pi settings.
