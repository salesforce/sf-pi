# ADR 0023: SF Code Analyzer exposes one family LLM tool

SF Code Analyzer exposes a single LLM-callable tool named `code_analyzer` with action modes such as `run`, `rules`, `config`, `doctor`, and `last_report`, rather than one tool per Code Analyzer command. A single family tool keeps prompt footprint and routing simple, preserves room for shared report/state handling, and matches the SF Pi pattern used by other broad workflow extensions.
