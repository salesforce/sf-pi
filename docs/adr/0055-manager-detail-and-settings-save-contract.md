# Manager detail and settings save contract

SF Pi Manager extension detail pages are user control pages, not developer metadata inspectors: they should show purpose, state, settings/actions, and enablement controls while leaving bundle paths and raw runtime-surface inventories to generated docs, catalog files, and READMEs. Configurable extension settings use a save-in-place contract: edits show explicit dirty state, `S`/`Enter` persists without navigating away, `Esc`/Back navigates away and discards unsaved drafts, and reload is required only when the saved value changes Pi runtime registration or session-start state.

**Consequences**

- `/sf-*` no-args commands remain shortcuts into the Manager Surface, but every bundled extension must also be listed in `package.json.pi.extensions`; manifest/catalog presence alone does not make Pi load the command.
- Settings panels should call their `done()` callback only when the user leaves the settings page or when the Manager must apply a runtime reload. A normal in-place save updates the persisted setting and the panel's saved baseline, then stays open.
- A setting requires reload when it affects command/provider/tool registration, extension enablement, startup/session hooks, system-prompt/context injection, or state read only during extension/session initialization. A setting does not require reload when the owning runtime path reads it dynamically or can refresh in memory.
- When a saved change does require reload, the panel should make that visible as a reload-required state instead of silently navigating away. The Manager remains responsible for applying reload when a config panel returns `{ needsReload: true }`.
