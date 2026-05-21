---
title: "SF Feedback"
description: "Guided GitHub feedback flow with sanitized diagnostics for SF Pi issues."
---

# SF Feedback

Guided GitHub feedback flow with sanitized diagnostics for SF Pi issues.

## What it is

Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue

## At a glance

| Property         | Value                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-feedback`                                                                                                        |
| Category         | Assistive                                                                                                            |
| Maturity         | stable                                                                                                               |
| Default state    | on                                                                                                                   |
| Runtime surfaces | commands                                                                                                             |
| Source           | [`extensions/sf-feedback/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-feedback)                    |
| Full README      | [`extensions/sf-feedback/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-feedback`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-feedback
/sf-pi disable sf-feedback
/sf-pi status sf-feedback
```

## Runtime surfaces

- **Commands:** `/sf-feedback`

## Safety and privacy

- Never submits a GitHub issue without user confirmation.
- Diagnostics are sanitized before preview or submission.
- Headless mode emits a draft and fallback URL only.

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/index.ts)
- [`lib/diagnostics.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/lib/diagnostics.ts)
- [`lib/github.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/lib/github.ts)
- [`lib/sanitize.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/lib/sanitize.ts)
- [`lib/issue-template.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/lib/issue-template.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-feedback)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md#troubleshooting) for extension-specific recovery steps.
