# ADR 0009: Data 360 parity stays pi-native, generated, and phase-guided

## Status

Accepted

## Context

SF Data 360 needs broad coverage of the public Data 360 operation surface while staying simple, performant, transparent, and native to pi. The public upstream Data 360 MCP server is the reference source for operation-family coverage, but SF Pi should not run or embed that server as a fallback because doing so would add a second runtime model, duplicate authentication behavior, and hide the pi-native technique from users.

## Decision

SF Data 360 will pursue first-class parity through generated, data-driven artifacts and pi-native runtime surfaces. Repeated operation coverage belongs in reviewed source data, generated registries, generated phase guidance, and parity tests; hand-written TypeScript stays focused on shared execution, target-org resolution, safety classification, rendering, truncation, and genuinely distinct runbooks.

The Data 360 Skill Pack is phase-first: Connect, Prepare, Harmonize, Segment, Act, Retrieve, Observe, and Orchestrate. Generated family and operation mappings can appear inside those phase skills, but endpoint families are not the primary user-facing language. The generated phase `SKILL.md` files are committed so pi can discover them through the normal extension-owned skill path without runtime generation.

SF Brain only routes Data 360 intent to SF Data 360 skills and tools. It must not embed operation catalogs, endpoint examples, or upstream implementation details.

The upstream repository is an upstream reference fallback only: agents may consult it when local SF Pi references are insufficient, and parity reports may compare against it, but SF Data 360 does not clone, launch, proxy, or depend on it at runtime.

## Considered Options

- **Runtime MCP fallback:** rejected because it would add Java/MCP runtime dependency, duplicate auth/session behavior, and conflict with the pi-native tool and skill model.
- **Hand-written full parity:** rejected because 180+ operations would produce endpoint sprawl and make the extension harder to test, review, and maintain.
- **Curated-only coverage:** rejected because the product goal is full first-class Data 360 parity, not only a small set of helpers plus raw REST escape hatches.

## Consequences

- Full parity work must follow a red/green TDD loop. Behavior changes start with failing tests; generator changes start with failing check/snapshot/parity tests; refactors start with characterization coverage.
- Startup and prompt footprint stay strict: no live org calls, broad catalog scans, or verbose always-on skill descriptions before user intent is clear.
- Rich transparency is delivered after intent through tool details and custom TUI rendering. Tool results should show endpoint, method, parameters, sanitized body, orchestration steps, safety decision, result summary, and raw-output pointers to humans while keeping LLM-visible content bounded.
- Generic SF Pi primitives may live in `lib/common`; Data 360 registry behavior, safety interpretation, phase mappings, and execution explanations stay inside SF Data 360 unless another extension needs the same stable contract.
