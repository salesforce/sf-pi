---
id: "0153"
status: accepted
date: 2026-11-03
---

# ADR 0153: SF Fin uses a Pi-owned token and the installed Fin CLI

SF Fin connects SF Pi to a Fin (formerly Intercom) workspace. Fin exposes two programmatic surfaces with different authentication: a remote MCP server that supports OAuth with dynamic client registration and refresh tokens, and a CLI (`@intercom/cli`) that accepts only a pasted workspace access token and has no refresh.

SF Fin owns only the CLI credential. Interactive `/login sf-fin` asks for the workspace hosting region (US, EU, or AU) with a select prompt, then collects the personal API token through SF Pi's shared fixed-mask credential input (ADR 0087). Pi alone persists the API-key credential under provider id `sf-fin`, with the region in `credential.env.INTERCOM_REGION`, and `/logout sf-fin` owns removal (ADR 0078). `INTERCOM_TOKEN` and `INTERCOM_REGION` remain non-persisted automation fallbacks.

SF Fin runs the user's installed CLI rather than bundling it or calling its endpoints directly, following the CLI-first boundary of ADR 0020. The CLI's build endpoints are versioned as unstable, and its native keyring dependency should not enter the SF Pi runtime. Each run uses `spawn` without a shell and enforces a timeout and output cap. The child receives an allowlisted environment containing the token and region, never argv. `INTERCOM_CONFIG_DIR` points at an SF Pi-private directory, so the user's own CLI keychain entry and `~/.intercom` files are never read or written. Output is scrubbed of the token, and outcomes map from the CLI's documented exit codes. The status file holds only non-secret workspace identity.

The first version exposes only `status` and a read-only `doctor` (`intercom --version`, `intercom me`). The CLI automatically calls `POST /fin-sdk/enable` when a Fin SDK request is refused as not enabled, so any `fin …` command is treated as potentially mutating and must be Guardrail-mediated before it is exposed.

The Fin MCP server is out of scope for SF Fin. It will be added as an SF MCP preset so that Pi's native MCP runtime owns its OAuth consent, token storage, and refresh (ADR 0137, ADR 0145).
