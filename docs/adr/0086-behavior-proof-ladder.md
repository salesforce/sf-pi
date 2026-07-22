# ADR 0086: Behavior Proof Ladder

Status: accepted

Every **Deletion-Gated Adoption Milestone** must climb the smallest sufficient evidence ladder before removing the old path: pure behavior tests; an integration test against the exact supported Pi package through real runtime/resource/session seams; focused checks plus typechecks at both **Pi Runtime Support Window** edges and the full suite; opt-in live proof for external behavior fixtures cannot establish; and manual narrow/wide TUI QA only when visible rendering changes.

Source-string assertions may enforce static policy but never satisfy the behavior gate. Live proof is scoped rather than exhaustive—for example, one Gateway route per transport family—and its artifact must show the changed path executed. Deletion proceeds only when parity evidence is green and residual risk is bounded; SF Pi does not retain a parallel fallback merely because the new path is difficult to verify.
