# Security

Thank you for helping keep SF Pi and its users safe.

## Reporting a vulnerability

Please report security issues through Salesforce's vulnerability reporting path:

<https://www.sfdc.co/SubmitVuln>

Do not open a public GitHub issue for suspected vulnerabilities, leaked secrets,
credential exposure, or bugs that could let an agent perform unintended
high-value mutations.

## Supported versions

Security fixes are made on the `main` branch and released through the normal
release automation. Users should stay on the latest published version of SF Pi
and the supported pi runtime version listed in `package.json` and the README.

## Security model

SF Pi is a pro-code developer tool and supports mutation. The security boundary
is not "all mutation is forbidden." Instead, SF Pi applies known-surface
mediation for risky action surfaces it owns and can classify.

See [Security model](./docs/security-model.md) for:

- the user intent boundary
- high-value durable mutation handling
- SF Guardrail Safety Envelopes and session approvals
- operator-approved headless mode
- prompt-injection control mapping
- what SF Pi does and does not claim to sandbox

## Secure development practices

See [Secure development](./docs/secure-development.md) for the repository's
validation, scanning, dependency, and review practices. See
[Threat model and secure-design review](./docs/threat-model.md) for the public
threat model and remediation evidence packet.

Security-relevant checks include:

- secret scanning with Gitleaks and TruffleHog
- dependency review, OSV scanning, and production `npm audit`
- CodeQL where repository settings allow it
- TypeScript, ESLint, tests, docs-health, SPDX, and generated-catalog checks
- Salesforce Code Analyzer scans for explicit security-review milestones

## Public content and data handling

SF Pi is public. Do not commit secrets, org credentials, real Salesforce org or
Slack identifiers, customer details, internal/private hostnames, or copied
private-source examples.

See [Public sanitization](./docs/public-sanitization.md) for source, docs,
examples, test fixtures, and diagnostic-publication rules.

## Configuration and credentials

SF Pi extensions should avoid shipping default private endpoints or credentials.
User credentials belong in pi's auth store, saved config files with restrictive
permissions, or user-controlled environment variables. Public examples should use
generic placeholders.

If you believe a secret was committed, report it immediately through the
vulnerability reporting path above so it can be rotated and remediated.
