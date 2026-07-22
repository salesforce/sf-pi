# ADR 0087: Secure Native Credential Prompt Is a Prerequisite

Status: accepted; applies to interactive credential delegation, not Pi 0.81 runtime adoption

SF Pi will not enable interactive secret entry through Pi-native authentication until Pi's TUI honors `AuthPrompt.type: "secret"` with masked input and never echoes the submitted value. Published Pi 0.81.0 and 0.81.1 route secret and text prompts through the same ordinary input and render the submitted value, so type-level support does not satisfy the **Behavior Proof**.

SF Pi can adopt the Pi 0.81.1 runtime without violating this prerequisite by rejecting SF Docs and SF Slack interactive login before any secret prompt appears. Existing stored credentials and environment-variable automation remain usable; Connect shows containment guidance, and Disconnect hands removal to native `/logout`, which collects no secret.

SF Pi does not patch or fork the Pi runtime, write `auth.json`, import private storage, accept visible secret entry, or create another secret store. Users who entered a credential through an affected visible input are instructed to rotate it explicitly; SF Pi never rotates or deletes it silently.

A future Pi release with a masked, non-echoed TUI behavior test is required before enabling native `/login` handoff. That release can raise the **Pi Runtime Floor** in a later deletion-gated slice, but it is not required for the contained 0.81.1 runtime adoption in ADR 0079.
