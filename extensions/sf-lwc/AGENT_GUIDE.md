# SF LWC Agent Guide

Use this guide for the local Lightning Web Component lifecycle. `sf_lwc` owns project scanning, component inspection, focused diagnostics, bounded Jest execution, and artifacts. It does not deploy, retrieve, install dependencies, or provide a visual browser preview.

## Behavior-proof-first loop

1. Use `project.scan` and `component.inspect` to establish the bundle and existing tests.
2. Reproduce behavioral defects with the smallest focused Jest test when feasible.
3. Edit the component with normal Pi file tools.
4. Run `file.diagnose` on changed JavaScript, HTML, CSS, and metadata files.
5. Use `test.plan` and `test.run` for the smallest relevant test file/name.
6. Iterate with `history.rerun`; keep full stdout/stderr and JSON in LWC Artifacts.

## Boundaries

- The tool scans only SFDX package directories declared by `sfdx-project.json`.
- `test.run` uses the existing local `lwc-jest` runner. It never installs packages or starts watch mode.
- Use `sf_apex` for Apex controller behavior and `sf_soql` for org schema evidence.
- Use Code Analyzer for broader static analysis and SLDS-specific guidance for SLDS 2 migrations.
- Use SF Browser only when last-mile visual or Salesforce UI evidence is required.

## Related domain skills

Prefer `sf_lwc` when it can do the action. If it cannot, read one of these Salesforce skills:
`experience-lwc-generate` · `experience-lwc-design-generate` · `experience-lwc-accessibility-validate` · `experience-lwc-security-validate` · `experience-lwc-rtl-validate` · `experience-lwc-typescript-migrate` · `experience-lwc-runtime-observe` · `experience-lwc-base-components-integrate` · `experience-aura-lwc-migrate`
