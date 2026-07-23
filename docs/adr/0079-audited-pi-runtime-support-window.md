# ADR 0079: Audited Pi Runtime Support Window

Status: accepted; Pi 0.81.1 window implemented

While Pi remains on `0.x`, SF Pi claims support only for an audited minor line. The current inclusive floor is Pi 0.81.1 and the exclusive ceiling is 0.82.0. Package metadata, the runtime gate, Doctor/Welcome guidance, and required CI enforce `>=0.81.1 <0.82.0`; widening to 0.82 requires a new release audit and behavior proof.

Pi 0.81.1 still echoes values submitted through its stock secret prompt. SF Docs and SF Slack therefore reject interactive entry before that prompt appears. The Gateway complete Provider uses a behavior-proven SF Pi fixed-mask component inside public `ApiKeyAuth.login`, while Pi still owns persistence and logout; it never invokes the unsafe stock secret prompt. Existing stored credentials and environment-variable authentication remain usable through public runtime APIs.

Required CI tests the exact floor and the newest release inside the supported minor line. A next-minor canary may report future drift, but it does not expand the support claim.

[ADR 0084](./0084-agent-settled-update-coordinator.md) supersedes the initial decision to retire scheduled updates: opt-in automatic updates may continue only through an agent-settled, human-visible coordinator that never moves Pi outside this audited window. Until then, automatic Pi updates remain disabled while the independent Salesforce CLI update can continue.
