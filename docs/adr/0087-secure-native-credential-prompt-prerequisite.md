# ADR 0087: Shared Secure Credential Prompt Policy

Status: accepted; shared SF Pi provider UI implemented for Gateway, Docs, and Slack

SF Pi will not pass secrets through Pi 0.81.1's stock `AuthInteraction.prompt({type:"secret"})` because that TUI renders submitted values. Instead, providers that require interactive token entry use one shared, behavior-proven `ctx.ui.custom()` component from `lib/common/secure-credential-prompt.ts`. The component uses a constant-length mask, filters terminal controls, supports Kitty input and bracketed paste, clears its buffer before settlement, and cancels on abort, reload, shutdown, or session replacement.

The shared component is an input boundary only. It returns a canonical API-key or OAuth-compatible credential to Pi's provider login orchestration. Pi alone persists the credential and owns `/logout`; SF Pi does not patch or fork Pi, import private auth storage, write `auth.json`, create another secret store, or place secret values in settings, session entries, model context, status, logs, or terminal output.

Gateway, SF Docs, and SF Slack bind their prompt bridges during `session_start` and clear them during `session_shutdown`. Interactive entry is TUI-only. RPC, JSON, and print modes fail closed and continue to support existing Pi credentials plus provider-specific environment variables for automation.

Every provider must pass the same behavior proof: fixed masking while typing, no post-submit echo, cancellation/retry cleanup, no undo/yank recovery, canonical Pi persistence at restrictive file permissions, native logout removal, unchanged environment variables, and token-shaped sentinels absent from captures and configuration files. A provider-specific copy of the component is prohibited; changes land in the shared implementation and its common tests.
