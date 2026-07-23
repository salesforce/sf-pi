# ADR 0087: Secure Native Credential Prompt Is a Prerequisite

Status: accepted; Pi stock secret prompts remain prohibited, with a behavior-proven Gateway Provider UI exception

SF Pi will not pass secrets through Pi's stock `AuthInteraction.prompt({type:"secret"})` until Pi's TUI masks input and never echoes the submitted value. Published Pi 0.81.0 and 0.81.1 route secret and text prompts through the same ordinary input and render the submitted value, so type-level support does not satisfy the **Behavior Proof**. Provider-owned extension UI is allowed only when real-runtime evidence proves masking and Pi still owns credential persistence.

SF Pi can adopt the Pi 0.81.1 runtime without violating this prerequisite by rejecting SF Docs and SF Slack interactive login before any secret prompt appears. Existing stored credentials and environment-variable automation remain usable; Connect shows containment guidance, and Disconnect hands removal to native `/logout`, which collects no secret.

SF Pi does not patch or fork the Pi runtime, write `auth.json`, import private storage, accept visible secret entry, or create another secret store. Users who entered a credential through an affected visible input are instructed to rotate it explicitly; SF Pi never rotates or deletes it silently.

A future Pi release with a masked, non-echoed TUI behavior test remains required before SF Docs or SF Slack use Pi's stock secret prompt. M3A does not waive that rule: the Gateway Provider's `ApiKeyAuth.login` bypasses `AuthInteraction.prompt({type:"secret"})`, mounts a fixed-mask SF Pi `ctx.ui.custom()` component, returns the key directly to Pi credential persistence, and clears/cancels the session-bound UI on shutdown. Real Pi 0.81.1 terminal attestation proves the token sentinel is absent from login/logout captures and Gateway config while native `/logout` removes the Pi credential.
