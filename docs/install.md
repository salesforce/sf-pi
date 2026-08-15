---
title: Install SF Pi
description: Install Node.js, npm, pi, SF Pi, Salesforce CLI, and the managed Salesforce skill library.
---

# Install SF Pi

SF Pi runs inside the [pi coding agent](https://pi.dev). Follow this one-time
setup in order.

## Requirements

- Node.js `>=22.19`
- the npm version bundled with a supported Node.js installation; SF Pi declares
  no separate npm floor
- pi coding agent `>=0.82.0 <1.0.0`
- a Salesforce CLI installation appropriate for the host platform

## 1. Install Node.js and npm

Install [Node.js](https://nodejs.org/) **22.19 or newer** and verify the bundled
npm client:

```bash
node --version
npm --version
```

## 2. Review optional npm release-age policy

Some managed npm 11+ configurations delay newly published packages. If
`npm config get min-release-age` reports a nonzero value and you intentionally
want immediate Pi/package availability, set the user-level value to zero:

```bash
npm config get min-release-age
npm config set min-release-age 0 --location=user
npm config get min-release-age
```

This is an optional user-wide npm policy, not an SF Pi runtime requirement.
Older npm clients that do not expose this setting can skip this step. See npm's
[`min-release-age` documentation](https://docs.npmjs.com/cli/v11/using-npm/config/#min-release-age)
for details.

## 3. Install the latest Pi and SF Pi

These unpinned commands install the latest available releases. Install Pi,
verify it, and then install SF Pi globally from GitHub:

```bash
npm install --global --ignore-scripts @earendil-works/pi-coding-agent
pi --version
pi install git:github.com/salesforce/sf-pi
```

SF Pi's supported Pi range is `>=0.82.0 <1.0.0`. `/sf-pi doctor` reports
whether the installed Pi and SF Pi versions are current.

## 4. Install or update Salesforce CLI

Use npm as the single installation and update path:

```bash
npm install --global @salesforce/cli@latest
sf --version
```

See the official
[Salesforce CLI installation guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm)
for platform support and verification details.

## 5. Start Pi and verify the installation

Run Pi from the project directory where you want to work:

```bash
pi
```

Then enter:

```text
/reload
/sf-pi doctor
```

## 6. Install Salesforce skills

`sf-skills` is already bundled with SF Pi. Install the managed Salesforce skill
library globally so it is available in every project:

```text
/sf-skills defaults install global
/sf-skills summary
```

## 7. Install the recommended extensions

Install the complete curated package bundle:

```text
/sf-pi recommended install bundle:default
/sf-pi recommended status
```

A successful setup has:

- `/sf-pi doctor` reporting no blocking installation problem;
- `sf --version` printing the installed Salesforce CLI version;
- `/sf-skills summary` showing the managed Salesforce skills; and
- `/sf-pi recommended status` showing the curated bundle decisions.

<details>
<summary><strong>Advanced setup and manual updates</strong></summary>

### Project-only SF Pi installation

The standard installation is global. To make SF Pi available only in the
current project, use:

```bash
pi install -l git:github.com/salesforce/sf-pi
```

### Terminal font

If terminal glyphs appear as `?`, run:

```text
/sf-setup-fonts
```

Then select **MesloLGM Nerd Font Mono** in your terminal and reopen it.

### Manual updates

Update the three core installations with:

```bash
pi update --self
pi update git:github.com/salesforce/sf-pi
npm install --global @salesforce/cli@latest
```

Restart Pi or run `/reload`, then verify with `/sf-pi doctor`.

### Platform notes

Required CI continuously proves Ubuntu with Node 22. SF Pi contains documented
macOS, Linux, and WSL paths, but they are not all required release-blocking
matrix jobs. Native Windows receives manual fallbacks for some installers and is
best-effort; use WSL when Unix shell parity is required.

</details>

## Maintained support evidence

| Claim                | Maintained proof                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Node.js `>=22.19`    | `package.json` engines, preinstall check, doctor diagnostics, and required Ubuntu CI       |
| Pi `>=0.82.0 <1.0.0` | peer dependency, runtime-floor checks, and nightly exact-version compatibility jobs        |
| npm client           | no independent engine/package-manager floor; required CI uses the npm bundled by Node 22   |
| Operating systems    | required CI proves Ubuntu; other platform paths are documented at their actual proof level |

## Next step

Continue with the [Quickstart](./quickstart.md).
