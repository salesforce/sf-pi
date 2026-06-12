# SF Browser Setup Runbooks

SF Pi setup work should be **API-First Browser-Ready**:

1. Use stable Salesforce APIs, metadata, data objects, or the owning SF Pi extension first.
2. Use SF Browser for UI evidence and last-mile gaps.
3. Use the UI Fallback Path only when the primary path fails, is unavailable, or a human needs visual confirmation.

These runbooks are intentionally documentation-first. Promote a runbook into a higher-level tool only after repeated real use proves the workflow is stable and worth encoding.

## Runbook template

Each runbook should answer:

- **Intent** — What are we trying to accomplish?
- **Primary path** — Which API, metadata, data object, or SF Pi extension should be used first?
- **Evidence path** — How does SF Browser navigate and capture proof?
- **UI Fallback Path** — If the primary path fails, what stable browser steps can complete or verify the task?
- **Known edge cases** — What tends to go wrong?
- **Setup destinations** — Which curated destination applies?

---

## Change My Domain name

**Intent**
Change, provision, or deploy an org's My Domain name when the task explicitly requires the Salesforce Setup UI.

**Primary path**
No stable metadata or CLI mutation path is assumed for renaming/provisioning My Domain. Before using the UI, confirm that the user really wants a My Domain change, because it can affect login URLs, redirects, integrations, and user access.

Use non-UI checks only for context and close-out verification. Do not treat a browser toast or page text alone as proof that the new domain is reachable.

**Evidence path**

1. Open the Setup Destination:
   ```json
   { "setup": "my-domain" }
   ```
2. Wait with `lightning: "navigation-ready"`.
3. Run `sf_browser_snapshot` with focus terms:
   ```json
   { "focus": ["My Domain", "Check Availability", "Save", "Deploy"] }
   ```
4. Capture before evidence with a public-safe label such as `before-my-domain-change`.
5. Use the visible Setup page state to identify whether the org is ready to rename, provisioning, ready to deploy, or already deployed.

**UI Fallback Path**
Use this path only when the user has explicitly requested the My Domain change and no stable non-UI mutation path is available.

1. Capture before evidence.
2. Enter only the user-requested domain value.
3. Check availability through the visible Setup control.
4. If the UI reports the value is unavailable or invalid, capture error evidence and stop. Do not guess another name.
5. If the UI offers a save/accept/provision action, click only the visible action that matches the requested step.
6. Wait for the page to settle, then snapshot again.
7. If provisioning is in progress, poll with waits/snapshots rather than repeated clicks.
8. Deploy only when the user explicitly requested deployment and the UI clearly presents the deploy action.
9. Capture after evidence.

**Independent verify loop**
After the UI reports success or readiness, verify reachability outside the browser automation session using the hostname shown by Setup:

```bash
curl --head --location --max-time 20 https://<my-domain-hostname>/
```

Treat a DNS, TLS, timeout, or connection failure as not yet verified. A normal Salesforce login redirect or HTTP success response is a reachability signal, not proof that every integration has been updated.

**Known edge cases**

- My Domain Setup can render as a Classic Setup Surface inside the Lightning Setup shell.
- A click may fail with a covered-element diagnostic when the frame host receives the hit-test. Capture diagnostics and use the same-origin iframe escape hatch only as a last-mile recovery until SF Browser has native in-frame retry.
- Provisioning may take time. Avoid repeated clicks while the UI is waiting.
- The page may expose org-specific hostnames. Keep screenshots and examples public-safe before sharing them externally.
- Deployment and login-policy changes can affect active users and integrations; do not perform them as a background convenience step.

**Setup destinations**

- `my-domain`

---

## Verify Agentforce enablement

**Intent**
Confirm whether Agentforce is enabled in an org.

**Primary path**
Use a stable API or metadata surface if one is available and verified for the target org/version. If no stable API is known, use the evidence path.

**Evidence path**

1. Open the Setup Destination:
   ```json
   { "setup": "agentforce-agents" }
   ```
2. Wait for `Agentforce Agents`.
3. Run `sf_browser_snapshot` with focus terms:
   ```json
   { "focus": ["Agentforce", "New Agent", "Active"] }
   ```
4. Capture Browser Evidence with `dismissOverlays` enabled.
5. Confirm visible signals:
   - heading `Agentforce Agents`
   - Agentforce toggle shows `On`
   - `New Agent` button is visible
   - agent list/table is visible

**UI Fallback Path**
If explicitly asked to enable Agentforce and no stable API path is available, use the same destination, snapshot the toggle, click the toggle only when it is visibly off, wait for the UI to settle, snapshot again, and capture evidence.

**Known edge cases**

- Ambient overlays can obscure the toggle; use Browser Evidence with `dismissOverlays: true`.
- Setup page path may vary in future Salesforce releases; keep the destination curated, not guessed.
- Permissions may allow viewing but not changing the toggle.

**Setup destinations**

- `agentforce-agents`

---

## Open user record and verify user access

**Intent**
Find a user record and capture evidence of the user's setup state.

**Primary path**
Use SOQL/Data API first for user facts:

- `User`
- `Profile`
- `PermissionSetAssignment`
- `PermissionSetGroup` / related assignment objects after verifying schema

**Evidence path**

1. Open the Setup Destination:
   ```json
   { "setup": "users" }
   ```
2. Use the Users setup search/list UI to find the user.
3. Open the user detail page.
4. Snapshot with focus terms such as user name, username, profile, permission, or assignment.
5. Capture Browser Evidence.

**UI Fallback Path**
Use browser navigation to the user detail page when API lookup is insufficient for human confirmation or when the user must see the exact Setup UI state.

**Known edge cases**

- User search can match name, username, alias, or email differently.
- Some orgs show user detail in Lightning; others expose classic-style setup detail pages.
- Inactive/frozen users may need additional setup sections.

**Setup destinations**

- `users`

---

## Assign or remove a permission set

**Intent**
Assign or remove a permission set for a user.

**Primary path**
Use Salesforce data/API first after describing/verifying schema:

- `User`
- `PermissionSet`
- `PermissionSetAssignment`

For removal, delete the matching `PermissionSetAssignment`. For assignment, create the assignment only after confirming it does not already exist and the target user/license can accept the permission set.

Before a UI fallback assignment, pre-check compatibility:

1. Query the target user, profile, active state, and license-related fields available in the org.
2. Query existing assignments.
3. Query the candidate `PermissionSet` (`Id`, `Name`, `Label`, `LicenseId`).
4. Prefer a known-compatible path: remove/re-add an existing assignment for fallback proof, or use a known empty/no-license permission set.
5. Do not choose arbitrary permission sets for UI tests; license-permission mismatches can fail late in the Classic Setup Surface.

**Evidence path**

1. Open the target user record through the `users` destination.
2. Navigate to the Permission Set Assignments area on the user detail page.
3. Capture before/after Browser Evidence when a human needs confirmation.
4. Verify final state through SOQL when possible.

**UI Fallback Path**
If API assignment fails or is unavailable:

1. Open Users setup.
2. Search/open the target user.
3. Navigate to Permission Set Assignments.
4. Open Edit Assignments.
5. In the Classic Setup dual-list control, use `sf_browser_select` on the source listbox.
6. Click Add or Remove.
7. Snapshot before Save to confirm the option moved to the intended list.
8. Save.
9. Wait for the return state, but treat near-timeout waits as ambiguous.
10. Snapshot and capture evidence.
11. Verify through API if possible.
12. If validation appears, capture error evidence, verify that no partial assignment occurred, and recover through direct navigation instead of repeated Cancel clicks.

**Known edge cases**

- Permission set is already assigned.
- Permission set name vs label mismatch.
- Permission Set Group is needed instead of a Permission Set.
- User is inactive or frozen.
- Admin lacks permission to assign the requested permission set.
- Managed package permission sets can have namespace-specific names.
- User license can reject permission contents even when the permission set appears in the UI.
- The assignment editor is a Classic Setup Surface; `select` is more reliable than clicking options in the dual-list control.
- Save failures can leave the page in a sticky validation state; use UI Fallback Recovery.

**Setup destinations**

- `users`

---

## Assign or remove a permission set group

**Intent**
Assign or remove a permission set group for a user.

**Primary path**
Use Salesforce data/API first, but verify exact assignment object and fields in the target org before mutation. Do not guess schema names.

**Evidence path**
Use the user detail page and permission assignment areas to capture before/after evidence.

**UI Fallback Path**
Follow the same pattern as permission set assignment, using the permission set group assignment UI if present.

**Known edge cases**

- Permission set group recalculation can delay effective access.
- Muting permission sets can make assignment appear successful while access still differs.
- The setup UI can surface permission sets and groups in nearby but distinct areas.

**Setup destinations**

- `users`

---

## Data Cloud setup and readiness

**Intent**
Check whether Data Cloud/Data 360 is present, ready, or requires UI-only enablement.

**Primary path**
Use SF Data 360 tools first:

- `d360_probe`
- `d360_metadata`
- `d360` capabilities
- `d360_api` for direct REST calls when a capability is not available

**Evidence path**
Use SF Browser only for UI-only setup screens, enablement toggles, or human-facing screenshots after API readiness checks.

**UI Fallback Path**
If a Data Cloud feature requires Setup UI enablement and no stable API is available:

1. Open `data-cloud-setup` for Data Cloud Setup Home unless a more specific verified destination exists.
2. Snapshot the current state.
3. Follow visible setup steps only when explicitly requested.
4. Capture Browser Evidence.
5. Re-run `d360_probe` or the relevant API check after the UI change.

**Known edge cases**

- Data Cloud features are often license-, permission-, and data-space-dependent.
- Empty orgs can look like failures when they are simply unconfigured.
- Some setup screens launch multi-step assistants.
- Prefer `d360_probe` to distinguish readiness from feature gating.

**Setup destinations**

- `data-cloud-setup`

---

## External Client Apps and Connected Apps

**Intent**
Create, inspect, or validate OAuth client configuration.

**Primary path**
Use Metadata/API surfaces first for known deployable configuration:

- External Client App metadata when available
- Connected App metadata when available
- Permission policies and assignments through metadata/data APIs as appropriate

**Evidence path**
Use Setup UI screenshots to confirm policy, OAuth, or admin-console state that is difficult to infer from metadata alone.

**UI Fallback Path**
If Metadata/API coverage is incomplete:

1. Open `connected-apps` or `external-client-apps` through a curated destination, depending on the target app type.
2. Search/open the target app.
3. Snapshot configuration sections before editing.
4. Make the minimal explicit change.
5. Save, wait, snapshot, and capture evidence.
6. Retrieve/query metadata where possible to verify the final state.

**Known edge cases**

- Connected Apps and External Client Apps are adjacent but distinct concepts.
- OAuth policy settings can be split across app config and permission surfaces.
- Some managed-package apps may restrict editable fields.
- Avoid storing or exposing client secrets in screenshots or tool output.

**Setup destinations**

- `connected-apps`
- `external-client-apps`

---

## Sharing Settings and Security Settings

**Intent**
Inspect or adjust org-wide security/sharing controls.

**Primary path**
Use Metadata/API where stable and available. Retrieve before edit and verify the target metadata type/field before mutation.

**Evidence path**
Use Setup UI snapshots/screenshots for human confirmation of org-wide settings.

**UI Fallback Path**
If a specific setting is UI-only or API coverage fails:

1. Open `sharing-settings`, `session-settings`, or another verified security destination.
2. Snapshot current state.
3. Change only the explicitly requested setting.
4. Save and wait for confirmation.
5. Snapshot and capture evidence.
6. Re-retrieve/query where possible.

**Known edge cases**

- Some settings have broad org impact.
- Some changes are irreversible or have delayed recalculation effects.
- Sharing recalculation can take time after changes.
- Security pages often include adjacent settings that should not be changed accidentally.

**Setup destinations**

- `sharing-settings`
- `session-settings`

---

## Flow setup and activation evidence

**Intent**
Open, inspect, or confirm flow setup state.

**Primary path**
Use Metadata/Tooling APIs first for flow definitions, versions, and status.

**Evidence path**
Use the `flows` Setup Destination to capture the Flow list or launch Flow Builder for human evidence.

**UI Fallback Path**
If activation or builder-only state cannot be handled through metadata:

1. Open `flows`.
2. Search/open the target flow.
3. Snapshot visible status/version/action controls.
4. Perform the explicit action only if requested.
5. Wait for confirmation, snapshot, and capture evidence.
6. Retrieve/query flow state where possible.

**Known edge cases**

- Flow Builder may open in a builder surface with different frame/SPA behavior.
- Flow versions and active state must be distinguished.
- Some flows require tests or dependencies before activation.

**Setup destinations**

- `flows`

---

## Profiles evidence and fallback

**Intent**
Inspect profile setup state or capture evidence for profile-driven access.

**Primary path**
Use Metadata/Tooling/API first for profile metadata and permissions. Retrieve the relevant profile metadata before comparing or editing.

**Evidence path**

1. Open `profiles`.
2. Search/open the target profile if needed.
3. Snapshot relevant sections with focus terms such as profile label, object, field, app, or permission name.
4. Capture Browser Evidence, using `scrollToRef` for lower-page sections.

**UI Fallback Path**
Use the profile UI only when metadata/API coverage is unavailable or a human needs visual confirmation. Change only explicitly requested settings, then retrieve/verify metadata where possible.

**Known edge cases**

- Profile pages are often Classic Setup Surfaces.
- Profile permissions are broad and easy to over-edit; prefer metadata diffs.
- Managed-package profile entries can appear with namespace-specific labels.

**Setup destinations**

- `profiles`

---

## Permission set groups evidence and fallback

**Intent**
Inspect, assign, remove, or validate Permission Set Groups.

**Primary path**
Use Salesforce data/API first, after verifying exact assignment objects and fields in the target org.

**Evidence path**

1. Open `permission-set-groups` for the group list.
2. Open `users` for user assignment evidence.
3. Capture before/after evidence when a human needs visual confirmation.
4. Verify final assignment state through API when possible.

**UI Fallback Path**
Use the same Classic Setup dual-list approach as permission set assignment when the assignment UI is present: select the source listbox with `sf_browser_select`, click Add/Remove, snapshot before Save, save, then verify through API.

**Known edge cases**

- Permission set group recalculation can delay effective access.
- Muting permission sets can make access differ from assignment state.
- The UI may place Permission Sets and Permission Set Groups near each other; verify labels before acting.

**Setup destinations**

- `permission-set-groups`
- `users`

---

## Named Credentials and External Credentials

**Intent**
Inspect or validate outbound authentication configuration.

**Primary path**
Use Metadata/API surfaces first for known deployable configuration:

- Named Credential metadata
- External Credential metadata, when available
- Permission set / principal access assignments, when applicable

**Evidence path**

1. Open `named-credentials` for Named Credentials evidence.
2. Use API/metadata to inspect External Credentials when UI path is not stable or secrets are involved.
3. Snapshot only non-secret configuration sections.
4. Capture Browser Evidence with secrets avoided or obscured.

**UI Fallback Path**
Use the UI only for unsupported setup state or human evidence. Do not expose client secrets, tokens, passwords, private keys, or authorization headers in screenshots or tool output.

**Known edge cases**

- External Credentials can be surfaced through newer setup pages, related tabs, or recent items depending on org/version.
- Secrets may be masked but should still be treated as sensitive.
- Principal access can be split across credentials and permission sets.

**Setup destinations**

- `named-credentials`

---

## Trusted URLs and Remote Site Settings

**Intent**
Inspect or validate outbound/embedded trust configuration.

**Primary path**
Use Metadata/API first:

- CSP Trusted Site / Trusted URL metadata where supported
- Remote Site Setting metadata where supported

**Evidence path**

1. Open `trusted-urls` for Trusted URLs / CSP Trusted Sites.
2. Open `remote-site-settings` for Remote Site Settings.
3. Snapshot list/detail state.
4. Capture Browser Evidence.

**UI Fallback Path**
If metadata coverage fails, create/update only the explicitly requested trusted origin or remote site. Save, snapshot, capture evidence, and retrieve metadata afterward when possible.

**Known edge cases**

- Trusted URLs and Remote Site Settings solve different problems and should not be conflated.
- URL matching rules and CSP context settings can be subtle.
- Some orgs use newer Trusted URLs naming while older docs say CSP Trusted Sites.

**Setup destinations**

- `trusted-urls`
- `remote-site-settings`

---

## App Manager and Lightning apps

**Intent**
Inspect Lightning apps, app navigation, and app-level configuration.

**Primary path**
Use Metadata/API first for CustomApplication and related metadata when available.

**Evidence path**

1. Open `app-manager`.
2. Snapshot the app list or target app row.
3. Capture Browser Evidence for human confirmation.

**UI Fallback Path**
Use App Manager UI only when metadata is insufficient or for visual verification. For edits, make the smallest explicit change, wait for confirmation, then retrieve metadata when possible.

**Known edge cases**

- App Manager can include Lightning apps, connected app-adjacent entries, and managed-package apps.
- Some edit flows open builders or multi-step wizards.
- Navigation item order can be metadata-backed but easier to verify visually.

**Setup destinations**

- `app-manager`

---

## Identity Provider and Single Sign-On Settings

**Intent**
Inspect identity-provider and SAML/SSO setup state.

**Primary path**
Use metadata/API first for known deployable configuration where available.

**Evidence path**

1. Open `identity-provider` for identity-provider setup evidence.
2. Open `single-sign-on-settings` for SAML/SSO setup evidence.
3. Capture screenshots that avoid certificates, secrets, and sensitive endpoint details unless explicitly needed and safe.

**UI Fallback Path**
Use UI fallback for fields or setup flows that are not metadata-covered. Verify through metadata/API where possible after any change.

**Known edge cases**

- Certificates and SSO settings are security-sensitive.
- Some values are intentionally masked or only visible during creation.
- Metadata coverage differs between identity-provider and SAML configuration surfaces.

**Setup destinations**

- `identity-provider`
- `single-sign-on-settings`

---

## Certificate and Key Management

**Intent**
Inspect certificate, key, and API client certificate setup state.

**Primary path**
Use metadata/API first for certificate metadata where supported. Avoid exporting or exposing private key material.

**Evidence path**

1. Open `certificate-key-management`.
2. Snapshot certificate list/status sections.
3. Capture Browser Evidence only for non-secret visible state.

**UI Fallback Path**
Use UI fallback only for explicit certificate/key tasks that cannot be completed by metadata/API. Avoid screenshots of secret material.

**Known edge cases**

- Certificate expiration/status matters more than raw certificate contents for most evidence tasks.
- Key material and downloads are sensitive.
- Some certificate operations can have broad auth/integration impact.

**Setup destinations**

- `certificate-key-management`

---

## Login History evidence

**Intent**
Inspect recent login activity for identity/security troubleshooting.

**Primary path**
Use SOQL/API first where available, such as login history objects supported by the target org.

**Evidence path**

1. Open `login-history`.
2. Snapshot filters/table headings and relevant rows.
3. Capture Browser Evidence when a human needs visual confirmation.

**UI Fallback Path**
Use browser UI for human evidence or when API access is restricted. Avoid exposing IPs or usernames in public artifacts.

**Known edge cases**

- Login history can contain sensitive usernames, IP addresses, and locations.
- Data retention windows vary.
- Prefer sanitized summaries for public output.

**Setup destinations**

- `login-history`
