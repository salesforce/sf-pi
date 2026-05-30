# ADR 0020: SF Code Analyzer uses the Salesforce CLI contract first

SF Code Analyzer v1 runs Code Analyzer through the supported `sf code-analyzer` CLI commands and parses generated output files instead of importing `@salesforce/code-analyzer-core` or engine packages directly. This matches the upstream CLI and VS Code integration shape, keeps engine dependencies out of the SF Pi runtime, preserves Salesforce CLI plugin lifecycle behavior, and makes long-running scans visible through normal Pi command/tool surfaces.

## Considered Options

- **CLI-first** — preferred for v1 because it is the smallest stable boundary and keeps SF Pi decoupled from Code Analyzer internals.
- **Direct package imports** — rejected for v1 because it would couple SF Pi to Code Analyzer core and every bundled engine package.
- **Hybrid execution** — deferred until a specific capability cannot be delivered through the CLI contract.
