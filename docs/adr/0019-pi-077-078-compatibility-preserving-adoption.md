# ADR 0019: Pi 0.77/0.78 compatibility-preserving adoption

## Status

Accepted

## Context

Pi 0.77 and 0.78 added several runtime features and extension-author helpers:

- session-level tool exclusion with `--exclude-tools` / `-xt`;
- streaming-aware extension input metadata;
- named startup sessions with `--name` / `-n`;
- clickable built-in file-tool paths;
- exported helpers such as `parseArgs`, `Args`, and `convertToPng`;
- stricter provider config value resolution where environment variables are expressed as `$ENV_VAR` / `${ENV_VAR}`.

SF Pi already supports Pi Runtime `>=0.76.0`. The release audit found several safe alignment changes, but no first-pass requirement to import 0.77/0.78-only APIs or to require all users to upgrade immediately.

The audit also surfaced a larger credential question for SF LLM Gateway. ADR 0007 says credential entry should converge on one primary path, while the gateway still has meaningful saved-config behavior for base URL, API key, project/global precedence, environment fallback, status, doctor, and usage probes. That migration is user-visible and larger than a release-note cleanup.

## Decision

Adopt Pi 0.77/0.78 through a **Compatibility-Preserving Adoption Slice** for the first pass. SF Pi will align with newer Pi Runtime behavior only where it can do so without raising the minimum supported **Pi Runtime** version, importing newer-only APIs, or adding compatibility shims.

This slice includes:

1. Treat **Pi Runtime Tool Selection Authority** as the rule for active tools. Bundled Extensions may narrow the Pi-selected active tool set for scope or safety, but must not re-enable tools excluded by native Pi Runtime tool selection.
2. Keep tool-routing facts in the **SF Pi Extension Context** and remove duplicate active-tool inventory from the **SF Environment Context**.
3. Let SF Welcome display the **Pi Session Display Name** when one exists, falling back to the existing project/cwd-derived label for older sessions.
4. Update provider registrations that intend to reference environment variables to use explicit `$ENV_VAR` syntax.
5. Fix stale user-facing copy discovered during the audit, such as default-model labels that still mention an older model.

This slice excludes:

- raising `MIN_PI_VERSION` or the package peer dependency solely for release-note awareness;
- importing Pi 0.78 helpers such as `parseArgs` or `convertToPng` without a real production need;
- adding a new `input` observer only to consume `InputEvent.streamingBehavior`;
- building an SF Pi per-tool toggle surface that duplicates `--exclude-tools`;
- migrating SF LLM Gateway credentials to a different canonical store.

## Consequences

- SF Pi remains compatible with the existing Pi Runtime floor while still respecting newer runtime behavior.
- Tool availability has one authority: Pi Runtime selection first, then extension narrowing.
- Prompt context has clearer locality: Salesforce org/project facts live in the SF Environment Context; extension routing and active extension tools live in the SF Pi Extension Context.
- SF Welcome can benefit from native session names without inventing an SF Pi naming surface.
- The SF LLM Gateway credential migration remains an explicit follow-up architecture topic rather than an incidental cleanup.

## Deferred follow-up

Revisit SF LLM Gateway credential ownership as a separate design pass. That pass should decide whether ADR 0007 should be implemented literally for the gateway API key, or amended to document why gateway saved config remains canonical because credentials and gateway root configuration are coupled.
