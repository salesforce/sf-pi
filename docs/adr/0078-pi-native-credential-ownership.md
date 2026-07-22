# ADR 0078: Pi-Native Credential Ownership

Status: accepted; Pi 0.81 runtime containment implemented, native login requires ADR 0087's secure prompt proof

SF Pi will use Pi provider authentication as the sole credential-mutation seam for SF Docs, SF Slack, and SF LLM Gateway. Pi-native `/login` owns secret input and persistence, and `/logout` owns removal. Integration panels retain status, diagnostics, credential-source reporting, and a visible handoff that can prefill the native command, but they must not write `auth.json`, import private `AuthStorage` code, or maintain a second secret store. Environment variables remain the automation and headless fallback.

Gateway credentials are user-global Pi credentials. Project configuration may retain non-secret endpoint, model-scope, help, and certificate preferences, but it must not accept new secrets. Existing project-scoped Gateway tokens remain a read-only compatibility source during a bounded migration window: SF Pi never prints, auto-copies, or silently deletes them; it asks the user to authenticate through Pi, verify the new credential, and explicitly remove the legacy token.

This supersedes ADR 0007's panel-owned credential mutation because Pi 0.80.8 removed the extension-facing `ModelRegistry.authStorage` path and Pi 0.81 provides provider-owned authentication. Pi 0.81 runtime containment removes SF Docs/Slack extension-side `authStorage` calls, blocks visible credential entry, keeps existing/environment credential reads, and hands saved-credential removal to native `/logout`. Native `/login` migration cannot begin until [ADR 0087](./0087-secure-native-credential-prompt-prerequisite.md) proves masked, non-echoed secret entry.
