# SF Code Analyzer Agent Guide

Use `code_analyzer` for explicit Salesforce static-analysis, rule discovery, configuration, report inspection, and ApexGuru workflows.

## Workflow

1. Use `doctor` when engines or prerequisites may be unavailable.
2. Use `recipes` for curated scan profiles or `rules` to inspect selectors before a broad scan.
3. Run `run` against the smallest relevant files or changed scope with explicit rule selectors when known.
4. Keep full JSON/HTML/SARIF/CSV in report artifacts; use bounded inline findings for repair.
5. Use `last_report` to filter a prior artifact by engine, rule, or file without rerunning analysis.
6. Re-run the focused scan after repairs.

## Boundaries

- Automatic deferred scans and explicit user-requested scans are different workflows; do not turn every edit into a broad scan.
- Severity 1–2 findings are high-signal repair evidence. Lower-severity findings remain contextual and should not drive unrelated rewrites.
- `apexguru` is an explicit org-backed Apex performance analysis for one file.
- `apexguru_setup_help` returns setup guidance. Do not start browser setup without user approval.
- Code Analyzer never applies fixes automatically; use normal file tools after reviewing evidence.
- Use `sf_apex`, `sf_lwc`, and `sf_soql` for lifecycle-specific runtime/test/schema proof.

## Related domain skills

Prefer `code_analyzer` when it can do the action. If it cannot, read one of these Salesforce skills:
`dx-code-analyzer-run` · `dx-code-analyzer-configure` · `dx-code-analyzer-custom-rule-create` · `dx-apexguru-scan`
