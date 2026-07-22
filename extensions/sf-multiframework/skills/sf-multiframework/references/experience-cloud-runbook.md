# Experience Cloud React UI Bundle Runbook

Use this runbook when a Multi-Framework React app targets `Experience`, especially when the app has both public and authenticated routes.

## Deploy the full Experience metadata stack

External apps need more than the `UIBundle`:

```text
force-app/main/default/
  digitalExperienceConfigs/
  digitalExperiences/
    site/<SiteName>/
      sfdc_cms__site/<SiteName>/content.json
  networks/
  sites/
  uiBundles/<AppName>/
```

Current generated `content.json` shape:

```json
{
  "type": "sfdc_cms__site",
  "title": "MyPortal",
  "contentBody": {
    "authenticationType": "AUTHENTICATED_WITH_PUBLIC_ACCESS_ENABLED",
    "appContainer": true,
    "appSpace": "c__MyPortal"
  },
  "urlName": "myportal"
}
```

Deploy and publish:

```bash
npm run build
sf project deploy start --source-dir force-app -o TARGET_ORG --json
sf community publish --name "<ExperienceName>" -o TARGET_ORG --json
```

The publish URL may point at an underlying `...vforcesite` path. Verify the React app-container URL too.

## Public route pattern

If public React routes call Apex REST:

1. Grant the guest profile Apex class access to the curated endpoint.
2. Avoid broad guest object permissions unless you intentionally use platform data access.
3. Query behind Apex and select only unauthenticated-safe fields.
4. Make public criteria explicit.

Example:

```soql
WHERE Publish_to_Transparency_Board__c = true
  AND Stage__c = 'Approved'
  AND Final_Decision__c = 'Awarded'
WITH SYSTEM_MODE
```

A healthy public API returns real curated data. A missing Apex grant usually returns:

```text
403 You do not have access to the Apex class named: <ApiClass>
```

## Login and forgot password endpoints

External app templates may include Apex REST classes for auth, such as:

- `UIBundleLogin`
- `UIBundleForgotPassword`
- `UIBundleChangePassword`
- `UIBundleRegistration`

Guest users need Apex access to unauthenticated auth endpoints. Smoke test login with a bad password; the desired failure is invalid credentials, not Apex access failure:

```text
400 {"errors":["Invalid username or password."]}
```

## External user provisioning checklist

A Contact is not a login. For a reviewer/customer to authenticate:

1. Confirm or create the Contact.
2. Pick a standard external profile/license as the **source profile** only.
3. Clone that source profile into an app-specific external profile. Do not assign users to the stock standard external profile directly.
4. Add the cloned profile to the Experience site's member groups.
5. Enable standard external profile user creation/login if using standard external profiles as clone sources.
6. Ensure the Contact's Account owner has a User Role.
7. Create an active `User` linked to `ContactId` and assigned to the cloned profile.
8. Assign the app permission set.
9. Trigger a password reset or approved initial-password flow.

Common failures:

```text
portal account owner must have a role
```

```text
Allow using standard external profiles for self-registration, user creation, and login
```

## Reviewer/customer data security

Choose one pattern.

### Platform sharing

Grant object/FLS and record access so UI API or `WITH USER_MODE` queries return the intended rows.

### Curated Apex façade

Keep direct object access narrow/absent. Apex derives identity server-side and scopes every query/mutation.

Guardrails:

- never accept ContactId/UserId from the client;
- derive ContactId from the logged-in user;
- filter assignment/customer records by that derived identity;
- validate scope before DML;
- keep public, reviewer/customer, and internal payloads separate.

## Smoke tests

```bash
# Public app container
curl -i 'https://<site>/<AppPath>/'

# Public API
curl -s 'https://<site>/<AppPath>/sf/api/services/apexrest/<api>?view=public' | jq

# Guest should not access internal view
curl -i 'https://<site>/<AppPath>/sf/api/services/apexrest/<api>?view=internal'

# Guest should not mutate
curl -i -X POST 'https://<site>/<AppPath>/sf/api/services/apexrest/<api>' \
  -H 'Content-Type: application/json' \
  --data '{"action":"submitScore"}'

# Login endpoint reachable but bad password rejected by app logic
curl -i -X POST 'https://<site>/<AppPath>/sf/api/services/apexrest/auth/login' \
  -H 'Content-Type: application/json' \
  --data '{"email":"user@example.com","password":"wrong","startUrl":"/reviewer"}'
```
