# SF LLM Gateway

> **Optional provider.** SF LLM Gateway ships with no endpoint or credential.
> Configure a compatible gateway or disable the extension globally.

## What It Does

SF LLM Gateway registers one complete Pi Provider whose discovered models retain
their real API mode: Chat Completions, Responses, or Messages. Pi owns protocol
streaming, retries, cancellation, thinking selection, credential persistence,
provider-scoped model caching, and API dispatch. SF Pi owns gateway-root
normalization, conservative discovered-model metadata, diagnostics, usage, and
bounded terminal error guidance.

Startup performs no model-discovery request. Pi restores the last successful
provider catalog; a fresh uncached installation exposes no models until login or
an explicit refresh succeeds. Network failures and ambiguous empty discovery
responses retain that catalog. A sentinel-only `no-default-models` result is an
explicit access-empty state instead: SF Pi clears stale Gateway entries from the
selector until a later refresh returns callable models.

## Connecting

Use native provider login:

```text
/login sf-llm-gateway
  → review or enter the compatible gateway root URL
  → enter the API key in SF Pi's fixed-mask component
  → Pi persists the credential and performs a bounded refresh
```

The Manager also offers non-secret endpoint setup, token-page opening,
configuration import, diagnostics, model refresh, and supported onboarding
helpers. Imports may detect credential presence but never copy a secret; login
remains the credential boundary.

## Commands

`/sf-llm-gateway` opens the Manager detail page. Available subcommands include:

| Group     | Actions                                           |
| --------- | ------------------------------------------------- |
| Connect   | `setup`, `import-claude`, `open-token`, `onboard` |
| Routing   | `on`, `off`, `set-default`                        |
| Discovery | `refresh`, `models`, `doctor`, `usage-probe`      |
| Utilities | `tokens`, `fix-ca-bundle`                         |
| Reference | `status`, `help`                                  |

No-args falls back to text status outside an interactive TUI. Display-only
reports use human-only output and do not enter model context.

## Configuration

Non-secret saved configuration lives in
`~/.pi/agent/sf-llm-gateway.json` globally or
`.pi/sf-llm-gateway.json` per project. Project values override global values.
Credential and endpoint precedence is:

- API key: Pi credential → `SF_LLM_GATEWAY_API_KEY` → missing;
- root URL: project/global override → credential URL →
  `SF_LLM_GATEWAY_BASE_URL` → missing;
- optional help URL: saved value → `SF_LLM_GATEWAY_HELP_URL`;
- optional CA source: saved value → `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE`.

Configure a generic root such as `https://your-gateway.example.com`, not a
model-specific route. Known route suffixes are normalized before request-time
helpers derive protocol endpoints. Saved model scope can be additive or
exclusive; explicit enable/disable and default-model choices remain separate
user actions.

All gateway model costs are reported as zero because provider billing is handled
outside Pi. Usage status uses the available user/key information endpoints and
does not claim a lifetime counter when the service cannot prove one.

## Compaction Model Preference

Pi's native `compaction.enabled` setting remains the only switch for automatic
threshold and overflow compaction. Manual `/compact` remains available whether
automatic compaction is enabled or disabled.

SF Pi can optionally use a dedicated authenticated Gateway model for manual,
threshold, and overflow summaries without changing the active conversation
model. The shipped default is `active`, which leaves compaction entirely with
Pi's active model. Configure the preference from the Gateway Manager setup panel
or in global/project Pi settings:

```json
{
  "compaction": { "enabled": true },
  "sfPi": {
    "compaction": {
      "model": "sf-llm-gateway/claude-sonnet-5"
    }
  }
}
```

Set the model to `active` to restore Pi's built-in behavior. The Manager picker
uses the currently authenticated Gateway catalog rather than a hardcoded list;
for example, a user may choose a quality-oriented Sonnet model or a
latency-oriented Flash model when those entries are available to their
credential. If the configured model is unavailable, too small for the summary
request, returns an incomplete response, or fails, SF Pi warns once and falls
back to Pi's active-model compaction. Conversation data never leaves the
configured Gateway because this preference accepts only `sf-llm-gateway/*`
models.

## Diagnostics

`/sf-llm-gateway doctor` checks URL shape, credential readiness, model discovery,
health, redirects, TLS, and common authentication/routing failures.
`usage-probe` performs a fresh read-only usage lookup after key rotation or when
cached numbers look surprising.

For an opt-in local wire trace:

```bash
SF_LLM_GATEWAY_TRACE=1 pi
```

The trace is truncated on launch, filtered to the configured gateway root, and
written to `~/.pi/agent/sf-llm-gateway.trace.jsonl`. It can contain request and
response material; treat it as private diagnostic evidence and never commit it.

## Safety and Data Boundaries

- SF Pi's fixed-mask component collects API keys; Pi alone persists and removes
  active credentials.
- Setup and import paths store only non-secret settings and never print, copy, or
  delete credentials.
- Settings updates use the shared race-aware Pi settings helpers.
- No default URL, private hostname, certificate source, route alias, traffic
  policy, or secret ships in source.
- Provider setup performs no hidden model selection, enable/disable, discovery,
  usage probe, or update beyond the explicitly chosen action.
- Recognized access and configuration failures are replaced with bounded,
  protocol-neutral guidance; raw provider response bodies are not repeated.
- CA installation/download steps are explicit and human-confirmed.

## Troubleshooting

**No models are available after installation:** Run native login, then
`/sf-llm-gateway refresh`. Later offline starts can restore the last successful
catalog.

**Login saved the credential but refresh failed:** Run the doctor to distinguish
wrong root, authentication, redirect, TLS, timeout, or service failure. A failed
refresh does not replace the last successful cache.

**Refresh reports no assigned models:** The Gateway returned the explicit
`no-default-models` access state, so SF Pi removed stale Gateway models from the
selector. Request model access, then rerun `/sf-llm-gateway refresh`. SF Pi does
not silently switch the active conversation model or rewrite default settings.

**A request reports `team_model_access_denied`:** Run
`/sf-llm-gateway refresh`, then choose one of the returned models with `/model`.
If refresh returns no models, request model access from your Gateway
administrator.

**A request says the provider is not configured:** Run
`/sf-llm-gateway status`. Depending on the reported state, enable the provider,
run setup for the endpoint, or authenticate with `/login sf-llm-gateway`; then
refresh the catalog.

**A discovered model shows conservative metadata:** Refresh the catalog. Exact
public Pi catalog matches can contribute portable metadata, but provider
identity, headers, cost, and provider-specific compatibility are never copied.

**Requests fail while `curl` works on macOS:** Node may not trust a private CA
from the system keychain. Use the confirmed `fix-ca-bundle` action with an
explicit local candidate or configured source, then rerun the doctor.

**Usage or throttle status is stale:** Run `refresh` or `usage-probe`. Runtime
telemetry clears after a successful response and usage caches are bounded.

**Thinking changes after a model switch:** SF Pi never writes the active thinking
level. Review Pi's `/thinking` choice and `defaultThinkingLevel` setting.

**Saved and environment credentials conflict:** Pi's saved credential wins. Use
native login to replace it or remove the stale environment fallback.

**The dedicated compaction model falls back to the active model:** Refresh the
Gateway catalog and reopen the setup panel. Confirm that the saved model is
still available to the current credential and has enough context capacity for
the session being compacted.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-llm-gateway/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
