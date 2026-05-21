---
title: "SF Brain"
description: "Injects the Salesforce Operator Kernel as a persistent hidden message exactly once per session, with a lazy reference map for routing to deeper SF Pi and Salesforce resources."
---

# SF Brain

Injects the Salesforce Operator Kernel as a persistent hidden message exactly once per session, with a lazy reference map for routing to deeper SF Pi and Salesforce resources.

## What it is

High-density Salesforce operator kernel injected once per session — describe-before-query rules, API picker, anonymous Apex verification loop, and CLI power moves

## At a glance

| Property         | Value                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-brain`                                                                                                     |
| Category         | Assistive                                                                                                      |
| Maturity         | stable                                                                                                         |
| Default state    | on                                                                                                             |
| Runtime surfaces | events                                                                                                         |
| Source           | [`extensions/sf-brain/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-brain)                    |
| Full README      | [`extensions/sf-brain/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md) |

## How to use it

This extension works through session hooks rather than a direct slash command. Install SF Pi and keep the extension enabled to use it.

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-brain
/sf-pi disable sf-brain
/sf-pi status sf-brain
```

## Runtime surfaces

- **Events/hooks:** `before_agent_start`

## Safety and privacy

- Never registers tools or mutates settings; the kernel is delivered through the session entry log only.
- Honors a user override at &lt;globalAgentDir&gt;/sf-brain/SF_KERNEL.md.

## Configuration and state

State files:

- `&lt;globalAgentDir&gt;/sf-brain/SF_KERNEL.md`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/index.ts)
- [`lib/kernel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/lib/kernel.ts)
- [`SF_KERNEL.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/SF_KERNEL.md)
- [`SF_REFERENCE_MAP.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/SF_REFERENCE_MAP.md)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-brain)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md#troubleshooting) for extension-specific recovery steps.
