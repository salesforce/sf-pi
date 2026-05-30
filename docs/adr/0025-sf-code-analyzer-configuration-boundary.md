# ADR 0025: SF Code Analyzer does not create a shadow rule configuration store

SF Code Analyzer treats `code-analyzer.yml` / `code-analyzer.yaml` and per-run tool arguments as the source of truth for Code Analyzer behavior. SF Pi persists only SF Pi-owned state such as cached readiness, install-recommendation dismissal, targeted auto-scan preferences, and display preferences; `/sf-code-analyzer config` may show or generate upstream configuration through the official CLI, but it must not maintain a parallel rule or engine configuration model.
