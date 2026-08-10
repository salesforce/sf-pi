# ADR 0103: Salesforce Org Connections Use One Shared Module

## Status

Accepted

## Context

SF Pi extensions independently resolve Salesforce target orgs, create `@salesforce/core` connections, select API versions, construct `/services/data/vNN.N` paths, refresh authentication, apply timeouts, and paginate queries. These parallel paths have accumulated inconsistent hardcoded fallbacks, including JSforce's implicit API `50.0`, and make one connection defect require fixes across Apex, SOQL, Agent Script, Browser, Code Analyzer, Data 360, and Data Explorer.

Project `sourceApiVersion`, Salesforce CLI `org-api-version`, an SDK connection's current version, and the highest version advertised by an org are distinct facts. Treating any one of them as a universal fallback hides failures and can route newer resources through an old API contract.

## Decision

SF Pi adopts one deep **Salesforce Connection Module** under `lib/common/sf-conn/`. Every extension that creates a Salesforce Core org connection or sends standard target-org instance REST/query traffic uses its public `index.ts` Interface.

The Module owns target-org resolution, connection creation and reuse, bounded API-version discovery, API-version selection, targeted refresh, authentication refresh, versioned path construction, bounded requests, and bounded REST/Tooling query pagination.

API-version selection is deterministic:

1. Resolve the target org and any explicit `org-api-version` configuration.
2. Request the target org's unversioned `/services/data` catalog.
3. When discovery succeeds, select the highest numeric version advertised by the org, even when an older configured value exists.
4. When discovery fails, use the explicit configured `org-api-version` as a disclosed fallback.
5. When discovery fails and no configured fallback exists, fail before sending the business operation.

The Module never uses JSforce's implicit API `50.0`, a project `sourceApiVersion`, a hardcoded SF Pi version, or a guessed prior version as request authority. It never retries an already-started business operation under another API version.

Callers provide versionless resource paths. The Module returns target/version provenance with every result and exposes its already-versioned SDK Connection only for genuine SDK, SOAP, or metadata operations. Product-specific hosts such as Agentforce Evaluation or SFAP remain extension-owned Adapters, while their ordinary Salesforce instance REST/SOQL and base org identity use the shared Module.

Authentication refresh is single-flight per SDK Connection. A request retries once only after a definite expired-session response (HTTP 401 or `INVALID_SESSION_ID`), never after an ordinary permission 403, and it retains the originally selected API version.

Status-only surfaces remain cache-first and can display a **Last-Known Usable Status**, but cached presentation state does not authorize a Salesforce request. They use `getCachedSalesforceTarget()` to read local auth/config presentation facts without API discovery; only an explicit refresh may call `connectSalesforce()`.

## Consequences

- Extension tool schemas retain their existing `target_org` and timeout inputs; connection/version policy is centralized.
- Per-extension connection, API-version, path, generic request, authentication-retry, and query-pagination helpers are deleted as each extension migrates.
- Existing compatibility re-exports under SF Data 360 and public `lib/common/sf-rest` request-authority helpers are deleted after their final consumer migrates.
- No permanent old/new production paths remain. Migration is serial and deletion-gated under ADR 0086.
- A repository architecture check prevents new direct `Org.create`, `Connection.create`, `getApiVersion`, `setApiVersion`, `conn.version`, or versioned `/services/data/v...` construction in extensions, with narrowly documented exceptions only for non-instance product transports.
- Module import and session startup remain network-free. Connection and API-version discovery are lazy on an explicit Salesforce operation or refresh.
