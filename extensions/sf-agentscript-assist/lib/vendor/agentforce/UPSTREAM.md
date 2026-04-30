# Vendored: @agentscript/agentforce

This directory contains a build of the `@agentscript/agentforce` SDK from
[salesforce/agentscript](https://github.com/salesforce/agentscript), vendored so
that `sf-agentscript-assist` works offline, on plain `npm install`, without
requiring pnpm or a network round-trip.

**Do not edit the bundled files.** If upstream behavior needs to change, bump
the pin via `scripts/sync-agentforce-sdk.mjs` and commit the regenerated
bundle.

## Pin

- Upstream: https://github.com/salesforce/agentscript
- Commit: `b98c087bd09d91de7f4cc1bfe829a98be573aaa6` (`b98c087bd0`)
- Package version: `@agentscript/agentforce@2.5.19`
- Synced: 2026-04-23
- Build variant: parser-javascript (pure TS, no native/WASM deps)

## Files

| File | Purpose |
| --- | --- |
| `browser.js` | Self-contained ESM bundle of the SDK. Works in Node. |
| `browser.js.map` | Source map for the bundle. |
| `index.d.ts` | Bundled TypeScript declarations for the SDK. |

We vendor the `browser.js` bundle (not `index.js`) because it is a single
file with all dependencies inlined. `index.js` declares its workspace peers
(`@agentscript/language`, `@agentscript/compiler`, `@agentscript/parser`)
as external and would require us to vendor them too.

## License

The vendored code is distributed under the Apache License 2.0, identical to
this repository's license. Upstream copyright is held by Salesforce, Inc.
See the upstream repository for the full license text.

## Regenerating

Do not edit the vendored files by hand. To pick up an upstream fix:

```bash
# 1. Update UPSTREAM_SHA in scripts/sync-agentforce-sdk.mjs
# 2. Run:
node scripts/sync-agentforce-sdk.mjs

# 3. Commit the result. CI runs the same script with --check so drift is caught.
```

CI runs `scripts/sync-agentforce-sdk.mjs --check` on every PR to ensure the
committed vendor output matches what the pinned commit produces.
