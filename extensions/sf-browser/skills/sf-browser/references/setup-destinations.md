# SF Browser Setup Destinations

Setup Destinations are curated, public-safe shortcuts from stable names to Salesforce Setup paths. Prefer them over search-and-click navigation when the target Setup page is known.

This list is intentionally small. It is not a full Salesforce Setup sitemap.

| Destination                  | Path                                                    | Use for                                                                         |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `setup-home`                 | `/lightning/setup/SetupOneHome/home`                    | Setup landing page and general navigation starting point.                       |
| `agentforce-agents`          | `/lightning/setup/EinsteinCopilot/home`                 | Agentforce Agents setup, Agentforce enablement evidence, New Agent entry point. |
| `app-manager`                | `/lightning/setup/NavigationMenus/home`                 | App Manager / Lightning app list evidence and fallback navigation.              |
| `certificate-key-management` | `/lightning/setup/CertificatesAndKeysManagement/home`   | Certificates, keys, and API client certificate evidence.                        |
| `connected-apps`             | `/lightning/setup/ConnectedApplication/home`            | Manage Connected Apps, OAuth usage and policy evidence.                         |
| `data-cloud-setup`           | `/lightning/setup/CDPSetupHome/home`                    | Data Cloud Setup Home evidence after Data 360 API readiness checks.             |
| `external-client-apps`       | `/lightning/setup/ManageExternalClientApplication/home` | External Client Apps setup evidence and UI fallback navigation.                 |
| `flows`                      | `/lightning/setup/Flows/home`                           | Flow list, Flow Builder entry, flow activation evidence.                        |
| `identity-provider`          | `/lightning/setup/IdpPage/home`                         | Identity Provider setup evidence and fallback navigation.                       |
| `login-history`              | `/lightning/setup/OrgLoginHistory/home`                 | Login History evidence and identity/security investigation support.             |
| `named-credentials`          | `/lightning/setup/NamedCredential/home`                 | Named Credentials setup evidence.                                               |
| `object-manager`             | `/lightning/setup/ObjectManager/home`                   | Object and field setup navigation.                                              |
| `permission-set-groups`      | `/lightning/setup/PermSetGroups/home`                   | Permission Set Group list and assignment fallback support.                      |
| `permission-sets`            | `/lightning/setup/PermSets/home`                        | Permission Set list and assignment fallback support.                            |
| `profiles`                   | `/lightning/setup/EnhancedProfiles/home`                | Profile list/evidence and profile setup navigation.                             |
| `remote-site-settings`       | `/lightning/setup/SecurityRemoteProxy/home`             | Remote Site Settings evidence and metadata fallback support.                    |
| `session-settings`           | `/lightning/setup/SecuritySession/home`                 | Session timeout, clickjack, CSP, and related security setting evidence.         |
| `sharing-settings`           | `/lightning/setup/SecuritySharing/home`                 | Organization-Wide Defaults and sharing-rule evidence.                           |
| `single-sign-on-settings`    | `/lightning/setup/SingleSignOn/home`                    | SAML / SSO setup evidence and fallback navigation.                              |
| `trusted-urls`               | `/lightning/setup/SecurityCspTrustedSite/home`          | Trusted URLs / CSP Trusted Sites setup evidence.                                |
| `users`                      | `/lightning/setup/ManageUsers/home`                     | User records, user access evidence, permission-assignment fallback navigation.  |

## Promotion criteria

Add a new destination only when all are true:

1. The path is stable enough to be used as a shortcut.
2. The destination is useful for repeated SF Pi workflows.
3. The name is generic and public-safe.
4. A runbook or repeated task needs it.

## Usage

```json
{
  "target_org": "my-sandbox",
  "setup": "agentforce-agents",
  "purpose": "Verify Agentforce is enabled"
}
```

For unknown or one-off destinations, pass an explicit `path` instead of adding a destination prematurely.
