# Telemetry, Metrics, and Privacy

sf-pi does **not** collect active runtime telemetry.

No bundled sf-pi extension sends usage events from a user's machine, and sf-pi
has no telemetry endpoint. The project only uses aggregate metrics that GitHub
and npm already provide to repository/package maintainers.

## What sf-pi does not collect

sf-pi does not collect or transmit:

- prompts, assistant responses, tool calls, or tool results
- file contents, filenames, local paths, git remotes, or branch names
- Salesforce org aliases, org IDs, instance URLs, usernames, or emails
- Slack workspace/channel/user information
- model/provider API keys, Salesforce auth tokens, or environment variables
- command-level runtime usage from installed copies of sf-pi
- persistent user, device, or install identifiers

## Aggregate metrics we archive

The repository includes a scheduled GitHub Actions workflow,
[`.github/workflows/metrics-archive.yml`](../.github/workflows/metrics-archive.yml),
that archives aggregate maintainer metrics to a separate `metrics` branch.

The workflow runs on GitHub-hosted infrastructure, not on user machines. It
collects only aggregate data available to project maintainers through public
platform APIs:

- GitHub repository views and unique visitors
- GitHub repository clones and unique cloners
- GitHub popular referrers and paths
- GitHub release asset download counts
- npm download counts for the published `sf-pi` package

These metrics help maintainers understand discovery and distribution trends
without adding client-side telemetry.

## npm package metrics

sf-pi is publishable as the public npm package `sf-pi`. npm download counts are
aggregate package-distribution metrics. They do not tell maintainers who used
sf-pi, what project it was used in, or what happened during a pi session.

## Active telemetry policy

Active telemetry means an installed copy of sf-pi sends events while running on a
user's machine. sf-pi does not do this.

If active telemetry is ever proposed in the future, it must be reviewed as a
separate privacy-sensitive feature and must satisfy these minimum requirements:

1. Off by default.
2. Fully documented before release.
3. Previewable by the user before any event is sent.
4. Easy to disable with settings and environment variables.
5. No prompts, responses, tool payloads, file paths, org identifiers, customer
   names, emails, tokens, or credentials.
6. No persistent identifier unless the user explicitly opts in and can reset it.

Until such a feature is explicitly documented and released, assume sf-pi has no
active telemetry.
