---
id: "0120"
status: accepted
date: 2026-09-23
---

# ADR 0120: SF Flow supports Omni-Channel as a specialized family

## Context

ADR 0114 intentionally limited first-generation authoring to five general-purpose Core Flow Families and treated product-specific process types as specialized. Omni-Channel routing is a distinct Flow contract rather than another autolaunched trigger: Metadata API represents it as `processType=RoutingFlow`, a service channel launches it, a scalar Text input named `recordId` carries the work item, and Route Work selects the routing destination.

Treating this process type as generic specialized metadata leaves important correctness checks unknown. Treating it as Autolaunched Flow would emit the wrong process contract. A separate extension would fragment the existing one-Flow lifecycle and duplicate inspection, validation, lifecycle, and evidence behavior.

## Decision

SF Flow keeps the five **Core Flow Families** and adds Omni-Channel as its first **Supported Specialized Flow Family**. The public family name is `omni-channel`; the metadata discriminator remains `RoutingFlow`.

`author.plan` infers Omni-Channel only from explicit routing-flow concepts such as Omni-Channel, Route Work, routing flow, or service channel. A generic request to route a record to a queue remains ambiguous. Authoring supports queue routing, direct-agent routing with a required fallback queue, and target-org skills-based routing rules. Optional availability checks route only when the matching target reports an online agent; the fault and no-capacity outcomes assign the Text output `reasonForNotRouting`. An explicit no-route option provides the same output without requiring an availability call. Generated metadata uses caller-supplied IDs, Omni action version `2.0.0`, no org-specific literals, and Draft status.

When a target org is explicit, authoring performs bounded, read-only grounding for destination-relevant service channels, queues, routing configurations, skills, and active agents. The plan presents choices and readiness gaps; it does not silently select a routing resource or provision Omni-Channel configuration.

Local diagnostics recognize `RoutingFlow` as Omni-Channel and require:

- scalar Text input `recordId` available for input;
- at least one reachable Route Work action;
- `recordId`, service channel, and routing type inputs on each Route Work action;
- a queue for QueueBased routing;
- an agent plus fallback queue for direct-agent routing;
- a queue routing configuration and skill option for SkillsBased routing;
- matching target and routing types between Check Availability and downstream Route Work;
- a Text output `reasonForNotRouting` assigned by intentional no-route terminal paths;
- action version `2.0.0` as a Moderate portability expectation for new metadata.

The general `record-id-as-string` review rule does not apply to Omni-Channel because Text ID inputs are part of the platform contract. Route Work is not required to have a local fault connector because service-channel fallback can own flow-level routing errors. Existing legacy actions remain inspectable; new authoring uses version 2.0.0.

The existing one-file Metadata API check-only action remains the deployment-readiness boundary. Check-only does not prove routing behavior. Runtime proof requires a controlled non-production service-channel scenario and routing-state evidence. A direct-agent proof requires a `PendingServiceRouting` row with the expected preferred user and fallback queue. An unavailable proof requires a non-empty `reasonForNotRouting` and no PSR. `AgentWork` is expected only when an eligible user is online. Skills runtime remains unproven when the target org has no skills-based routing rules; activation alone is not green runtime evidence. Agentforce STDM can supplement evidence when an Agentforce session participates, but it does not replace routing or metadata proof.

## Consequences

- SF Flow gains first-class Omni-Channel planning, local diagnosis, org grounding, topology labels, and check-only evidence without becoming an Omni-Channel setup manager.
- Queue, direct-agent fallback, rules-based skills, availability, and intentional no-route authoring share one family boundary. Explicit SkillRequirement creation, bots, Agentforce destinations, screen pops, transfers, and voice remain later increments.
- Existing unknown specialized process types remain coverage-bounded rather than guessed.
- Public fixtures use generic caller-supplied IDs and do not contain customer metadata or org identifiers.
- Runtime routing remains explicit and potentially mutating; no live route is created during ordinary authoring or validation.
