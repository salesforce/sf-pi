# SF Agent Script References

Load only the reference needed for the current task. Start from
[`../AGENT_GUIDE.md`](../AGENT_GUIDE.md) and read one child.

Operating children:

- [`authoring.md`](./authoring.md) — create, compile/check, inspect, mutate
- [`preview.md`](./preview.md) — start/send/end, traces, cleanup
- [`eval.md`](./eval.md) — generate_spec, run, run_release, studio, integrity
- [`lifecycle.md`](./lifecycle.md) — publish, activate, agent user

Specialized refs:

- [`agent-user-setup.md`](./agent-user-setup.md) — diagnose and provision the Service Agent user, permission set, and Apex class access required by lifecycle actions.
- [`transitions.md`](./transitions.md) — choose deterministic or LLM-discretionary Agent Script transitions and recover from unsupported guarded syntax.
- [`DIAGNOSTIC_PARITY.md`](./DIAGNOSTIC_PARITY.md) — contributor evidence for official-package versus SF Pi hardening and quality diagnostics.

Current human behavior remains in [`../README.md`](../README.md).
