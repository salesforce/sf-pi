# SF Code Analyzer Roadmap

## Shipped

- CLI-first `code_analyzer` tool and `/sf-code-analyzer` command panel.
- Explicit `doctor`, `run`, `rules`, `config`, `last_report`, `apexguru`, `apexguru_setup_help`, and `recipes` actions.
- Deferred post-agent auto-scan for changed Apex, JavaScript/TypeScript, and Flow metadata files.
- Grouped local auto-scans by selector profile with friendly transcript rows.
- Broader scan suggestions and scan recipes, including Herdr handoff metadata.
- ApexGuru readiness cache, explicit ApexGuru action, setup guidance, and SF Browser handoff runbook.
- Project/global/default automation settings.
- Output modes and report artifact filtering.
- TDD seams for recipes, auto-scan planning, auto-scan follow-up, transcript formatting, settings, report filters, ApexGuru readiness, and basic orchestration.

## Pending hardening

### Auto-scan orchestration tests

Add focused tests for the remaining orchestration edge cases:

- One local scan group fails while another succeeds; successful findings and report paths are preserved.
- ApexGuru runs after local groups when readiness is enabled.
- ApexGuru is skipped when readiness is unavailable or stale.
- Repeated violation signatures stop the automatic repair loop.
- Broader validation guidance appears in the LLM follow-up when findings exist.

### User documentation polish

Keep the README and generated docs clear about:

- automatic vs explicit scans;
- `Recommended` vs `all` rules;
- scan recipes and Herdr handoff;
- ApexGuru availability and setup limitations;
- output modes and report artifacts;
- project/global automation settings.

## Non-goals

- Shipping Code Analyzer rules or engine packages inside SF Pi.
- Automatically running broad or noisy recipes such as `all`, `AppExchange`, `cpd`, or `sfge` from the deferred auto-scan path.
- Hiding browser automation inside `sf-code-analyzer`; SF Browser work must remain visible and user-approved.
