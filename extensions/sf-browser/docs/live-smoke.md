# SF Browser Live Smoke Checklist

Use this checklist after changing SF Browser navigation, waits, snapshots, or Browser Evidence. It exercises read-only browser paths against a connected sandbox/dev org and avoids data mutation.

Replace `my-sandbox` with the intended target org alias. The dev-time harness uses an isolated agent-browser session and asserts both the observed org host and exact path:

```bash
npm run e2e:sf-browser-harden -- --org my-sandbox --surface public-tools
npm run e2e:sf-browser-harden -- --org my-sandbox --surface setup-destinations
```

Use `--public-path /lightning/setup/.../home` to verify a candidate path before promoting it into the curated registry.

## 1. Resolve deterministic paths

```json
{ "target": { "type": "home" } }
```

Expected: `/lightning/page/home`.

```json
{ "target": { "type": "setup", "destination": "agent force" } }
```

Expected: resolves to `agentforce-agents`.

```json
{ "target": { "type": "setup", "destination": "apps" } }
```

Expected: returns multiple candidates and does not guess.

## 2. Open an object list and verify Lightning state

```json
{
  "target_org": "my-sandbox",
  "target": { "type": "object-list", "objectApiName": "Account" },
  "purpose": "SF Browser live smoke: object list"
}
```

Then wait and snapshot:

```json
{ "condition": { "type": "lightning", "value": "app-ready" } }
```

```json
{ "outputMode": "summary", "focus": ["Account", "New"], "maxDepth": 6 }
```

Expected snapshot signals:

- Lightning state `Surface: object-list`
- Lightning state `Object: Account`
- list/table or object-list actions visible

## 3. Capture session-scoped evidence

```json
{
  "label": "smoke-account-list-after-route-open",
  "imageMode": "artifact",
  "target_org": "my-sandbox",
  "includeSetupAuditTrail": true,
  "auditLookbackMinutes": 5
}
```

Expected:

- Evidence path is under `browser-artifacts/sessions/<session-id>/`
- `browser-artifacts/latest/pointer.json` points to the current session evidence directory
- Setup Audit Trail enrichment is either `queried` or gracefully `unavailable` / `skipped`

## 4. Open a curated Setup Destination and verify Lightning state

```json
{
  "target_org": "my-sandbox",
  "target": { "type": "setup", "destination": "agentforce-agents" },
  "purpose": "SF Browser live smoke: setup route"
}
```

Then:

```json
{ "condition": { "type": "lightning", "value": "app-ready" } }
```

```json
{ "outputMode": "summary", "focus": ["Agentforce", "New Agent"], "maxDepth": 6 }
```

Expected snapshot signals:

- Lightning state `Surface: setup-page`
- Lightning state `Setup destination: agentforce-agents`
- page heading or setup controls relevant to the destination

## 5. Optional object-new check

```json
{
  "target_org": "my-sandbox",
  "target": { "type": "object-new", "objectApiName": "Account" },
  "purpose": "SF Browser live smoke: object-new route without saving"
}
```

Then use a wait plus snapshot to inspect the actual org behavior. Do not assume a modal opens: org overrides, record type flows, object label overrides, or custom navigation can render a different page.

Recommended checks:

```json
{ "condition": { "type": "lightning", "value": "app-ready" } }
```

```json
{ "outputMode": "summary", "focus": ["New", "Account", "Save", "Record Type"], "maxDepth": 8 }
```

Expected:

- If the form appears, snapshot should show the relevant create UI.
- If the form does not appear, the wait/snapshot should report the actual state without claiming success.

## Pass criteria

A live smoke pass means the tools are deterministic, transparent, and evidence-producing. It does not require every org to render identical Lightning UI for `object-new`.
