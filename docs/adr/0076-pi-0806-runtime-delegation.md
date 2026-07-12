# ADR 0076: Pi 0.80.6 runtime delegation

Status: accepted

SF Pi will raise its **Pi Runtime Floor** to `0.80.6` as a dedicated **Runtime Floor Adoption Slice**, then treat the Pi 0.80.4–0.80.6 feature set as a **Runtime Delegation Program**: prefer Pi-native extension surfaces over duplicate SF Pi runtime mechanics when behavior proof shows the simpler path works.

The adoption order is intentionally vertical and test-first. First update package metadata, lockfile, runtime gate, docs, and version-floor tests without mixing product behavior into that slice. Then adopt behavior in narrow slices: migrate SF LSP **Human-Only Transcript Rows** to `appendEntry()` plus `registerEntryRenderer()`, move Code Analyzer's deferred scan to an **Agent-Settled Quality Gate**, add cautious model-specific `max` **Gateway Thinking Capability**, prove and replace gateway header workarounds through a **Gateway Header Proof Spike**, delegate generic gateway model/scoped-model parsing through **Model Resolution Delegation** only after a reviewed implementation plan and passing parity tests, and use **Native Resource Delegation** as a conservative deprecation path for duplicate global/project resource mechanics.

SF Pi will not synthesize gateway pricing tiers, copy direct-provider model metadata into SF LLM Gateway, build cache-miss UI that duplicates Pi, introduce a new trust model, or keep parallel old/new runtime paths after proof shows the Pi-native path is equivalent. The goal of this adoption is simpler SF Pi code with stronger behavior tests, not broad feature expansion.
