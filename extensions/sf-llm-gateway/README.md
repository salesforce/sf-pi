# SF LLM Gateway

> **Optional provider.** SF LLM Gateway ships with no endpoint or credential.
> Configure a compatible gateway or disable the extension globally.

## What It Does

SF LLM Gateway registers one complete Pi Provider whose authenticated discovery
IDs are published only when an exact public Pi catalog entry supplies a reusable
Chat Completions, Responses, or Messages API. Unmatched deployment IDs are
filtered without interpreting suffixes or backend routing. Pi owns protocol
streaming, retries, cancellation, thinking selection, credential persistence,
provider-scoped model caching, and API dispatch. SF Pi owns gateway-root
normalization, catalog admission, capability-coverage diagnostics, usage,
bounded terminal error guidance, Gateway terminal-close recovery, and the
exact-model priority request described below.

Startup performs no model-discovery request. Pi restores the last successful
provider catalog, and SF Pi applies the same exact-match admission policy to the
restored entries. A fresh uncached installation exposes no models until login or
an explicit refresh succeeds. Network failures and ambiguous empty discovery
responses retain the admitted catalog. A sentinel-only `no-default-models`
result is an explicit access-empty state instead: SF Pi clears stale Gateway
entries from the selector until a later refresh returns admitted models.

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

For Gateway Responses requests using exactly `gpt-5.6-sol` or `gpt-6-sol`, SF Pi
sends `service_tier: "priority"` automatically, including simple and full streams.
Other models and providers are unchanged. The request does not prove that the
Gateway honored the tier; SF Pi does not inspect or enforce the effective tier.

For Gateway Responses and Chat Completions requests, SF Pi omits the optional
`prompt_cache_key` request field. A Gateway model ID does not reveal which
backend will handle a request, and some backends reject this OpenAI cache-affinity
hint. The omission is Gateway-only and model-neutral; it may reduce cache
locality on compatible routes but does not disable other prompt caching or alter
other request fields.

A Gateway capability record is considered complete only when it declares the
route mode, positive input/output limits, vision support, reasoning support, and
function-calling support. Refresh status shows declared-versus-Pi-catalog model
counts. Missing or partial `/v1/model/info` is informational and does not disable
image input from an exact Pi-backed model; users don't need to control Gateway
metadata. Doctor warns only when an explicit Gateway vision/reasoning declaration
contradicts Pi, while the explicit `--image` probe verifies the deployed route.

For Responses routes, SF Pi gives the Gateway one second to close the HTTP body
after a terminal `response.completed` or `response.incomplete` event. If EOF does
not arrive, SF Pi aborts only that transport and recovers the already-completed
response when exactly one terminal event arrived and every observed output item
finished. Recovered responses carry a bounded diagnostic and warning badge.
Caller cancellation, duplicate terminals, and unfinished tool calls are never
recovered as success.

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
health, redirects, TLS, and common authentication/routing failures. Ordinary doctor
runs never invoke a model. Explicit stream modes make real, billable, bounded requests:

```text
/sf-llm-gateway doctor --stream <modelId> [--thinking <level>] [--count 1..3] [--tool|--image]
/sf-llm-gateway doctor --stream-canaries [--count 1..3]
```

The single-model probe checks plain response closure by default. `--tool` checks a
fixed tool-call and tool-result round trip; `--image` sends a generated one-pixel PNG
to verify the exact route without using user content. Use separate tool and image
probes. The canary matrix covers authenticated Opus 5.5 and GPT-6 Sol deployments at
`high` and `xhigh`, plus a GPT-6 generated-image probe. Each request has a 15-second
bound. A recovered terminal-close defect is reported as a warning rather than healthy.
Results contain only status and bounded timings. SF Pi does not upload, persist, or log
probe prompts, responses, credentials, URLs, or session identifiers; no telemetry is
collected.

`usage-probe` performs a fresh read-only usage lookup after key rotation or when cached
numbers look surprising.

## Safety and Data Boundaries

- SF Pi's fixed-mask component collects API keys; Pi alone persists and removes
  active credentials.
- Setup and import paths store only non-secret settings and never print, copy, or
  delete credentials.
- Settings updates use the shared race-aware Pi settings helpers.
- No default URL, private hostname, certificate source, route alias, or secret
  ships in source. The only client traffic-tier policy is the exact Gateway GPT
  Sol Responses priority request described above.
- Provider setup performs no hidden model selection, enable/disable, discovery,
  usage probe, or update beyond the explicitly chosen action.
- Discovery publishes only exact IDs backed by a reusable public Pi catalog API;
  unmatched deployment IDs are excluded without model-specific routing rules.
- Recognized access, unsupported-image, transient-stream, and configuration failures are replaced
  with bounded, protocol-neutral guidance; raw provider response bodies are not repeated.
- Generated-image probes use a fixed non-private one-pixel PNG and run only after an explicit command.
- Terminal-close recovery requires one terminal event and fully completed output items; partial tools
  remain errors.
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

**A Gateway model is absent after refresh:** SF Pi publishes only exact model IDs
with a reusable public Pi catalog API. Ask the Gateway administrator to expose a
canonical public ID, then refresh after the Pi catalog includes that ID. SF Pi
does not infer deployment aliases from model names.

**Requests fail while `curl` works on macOS:** Node may not trust a private CA
from the system keychain. Use the confirmed `fix-ca-bundle` action with an
explicit local candidate or configured source, then rerun the doctor.

**Usage or throttle status is stale:** Run `refresh` or `usage-probe`. The
session-memory warning clears after a successful response and usage caches are bounded.

**Thinking changes after a model switch:** SF Pi never writes the active thinking
level. Review Pi's `/thinking` choice and `defaultThinkingLevel` setting.

**Saved and environment credentials conflict:** Pi's saved credential wins. Use
native login to replace it or remove the stale environment fallback.

**The dedicated compaction model falls back to the active model:** Refresh the
Gateway catalog and reopen the setup panel. Confirm that the saved model is
still available to the current credential and has enough context capacity for
the session being compacted.

**A request reports an unsupported `prompt_cache_key`:** Update SF Pi and retry.
Current SF Pi omits this field on Gateway requests. If the error persists, ask
the Gateway administrator to check the selected model's parameter handling.

**A route rejects an image even though the public model supports images:** Exact
Pi-backed models retain their public image-input capability even when Gateway metadata
is unavailable. Run the explicit `--image` probe to verify the deployed route. If the
route rejects the generated image, use another verified model/route and share the
bounded diagnostic with the Gateway operator; end users don't need to publish metadata
or permanently downgrade the public model.

**A response shows `stream close recovered`:** The Gateway emitted a valid terminal
Responses event but did not close the HTTP body within the grace period. SF Pi preserved
the completed response, but doctor/canaries report a warning. Fix Gateway SSE closure;
do not disable the HTTP idle timeout.

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
