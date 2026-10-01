/* SPDX-License-Identifier: Apache-2.0 */
/** External Client App metadata generation, inspection, deployment, and test cleanup. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SF_MCP_HEADLESS_360_REQUIREMENT } from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import {
  ECA_METADATA_TYPES,
  type EcaInspection,
  type DeployableMetadataSource,
  type EcaMetadataType,
  type IntegrationAdapter,
  type IntegrationDeploymentResult,
  type IntegrationMetadataSource,
} from "./types.ts";

const DEPLOY_START_TIMEOUT_MS = 60_000;
const DEPLOY_POLL_TIMEOUT_MS = 5 * 60_000;
const DEPLOY_POLL_FREQUENCY_MS = 1_000;

interface MetadataClient {
  describe(version: string): Promise<{ metadataObjects?: Array<{ xmlName?: string }> }>;
  read(type: string, fullNames: string[]): Promise<unknown>;
  delete(type: string, fullNames: string[]): Promise<unknown>;
}

interface BuildHeadlessMcpSourcesInput {
  appName: string;
  appLabel: string;
  contactEmail: string;
}

export function buildHeadlessMcpSources(
  input: BuildHeadlessMcpSourcesInput,
): IntegrationMetadataSource[] {
  const appName = escapeXml(input.appName);
  const appLabel = escapeXml(input.appLabel);
  const contactEmail = escapeXml(input.contactEmail);
  const callbackUrl = escapeXml(SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl);
  const metadataScopes = SF_MCP_HEADLESS_360_REQUIREMENT.metadataScopes.join(", ");

  return [
    {
      type: "ExternalClientApplication",
      directory: "externalClientApps",
      filename: `${input.appName}.eca-meta.xml`,
      source: `<?xml version="1.0" encoding="UTF-8"?>
<ExternalClientApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <contactEmail>${contactEmail}</contactEmail>
    <description>Salesforce-hosted Headless 360 MCP client managed by SF Pi.</description>
    <distributionState>Local</distributionState>
    <isProtected>false</isProtected>
    <label>${appLabel}</label>
</ExternalClientApplication>
`,
    },
    {
      type: "ExtlClntAppGlobalOauthSettings",
      directory: "extlClntAppGlobalOauthSets",
      filename: `${input.appName}.ecaGlblOauth-meta.xml`,
      source: `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppGlobalOauthSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <callbackUrl>${callbackUrl}</callbackUrl>
    <externalClientApplication>${appName}</externalClientApplication>
    <isConsumerSecretOptional>true</isConsumerSecretOptional>
    <isIntrospectAllTokens>false</isIntrospectAllTokens>
    <isNamedUserJwtEnabled>true</isNamedUserJwtEnabled>
    <isPkceRequired>true</isPkceRequired>
    <isRefreshTokenRotationEnabled>true</isRefreshTokenRotationEnabled>
    <isSecretRequiredForRefreshToken>false</isSecretRequiredForRefreshToken>
    <label>${appLabel} OAuth</label>
    <shouldRotateConsumerKey>false</shouldRotateConsumerKey>
    <shouldRotateConsumerSecret>false</shouldRotateConsumerSecret>
</ExtlClntAppGlobalOauthSettings>
`,
    },
    {
      type: "ExtlClntAppOauthSettings",
      directory: "extlClntAppOauthSettings",
      filename: `${input.appName}.ecaOauth-meta.xml`,
      source: `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppOauthSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <commaSeparatedOauthScopes>${metadataScopes}</commaSeparatedOauthScopes>
    <externalClientApplication>${appName}</externalClientApplication>
    <label>${appLabel} OAuth</label>
</ExtlClntAppOauthSettings>
`,
    },
  ];
}

export const defaultIntegrationAdapter: IntegrationAdapter = {
  describeMetadataTypes,
  inspectEca,
  deploy: deployEcaSources,
  resolveContactEmail,
};

export async function describeMetadataTypes(session: SalesforceSession): Promise<Set<string>> {
  const metadata = session.connection.metadata as unknown as MetadataClient;
  const description = await metadata.describe(session.target.apiVersion);
  return new Set(
    (description.metadataObjects ?? [])
      .map((item) => item.xmlName)
      .filter((name): name is string => typeof name === "string"),
  );
}

export async function inspectEca(
  session: SalesforceSession,
  appName: string,
): Promise<EcaInspection> {
  const [application, globalOauth, oauth] = await Promise.all([
    readComponent(session, "ExternalClientApplication", appName),
    readComponent(session, "ExtlClntAppGlobalOauthSettings", appName),
    readComponent(session, "ExtlClntAppOauthSettings", appName),
  ]);
  const scopes = stringValue(oauth?.commaSeparatedOauthScopes)
    ?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    app_name: appName,
    components: {
      ExternalClientApplication: Boolean(application),
      ExtlClntAppGlobalOauthSettings: Boolean(globalOauth),
      ExtlClntAppOauthSettings: Boolean(oauth),
    },
    application,
    global_oauth: globalOauth,
    oauth,
    consumer_key: stringValue(globalOauth?.consumerKey),
    callback_url: stringValue(globalOauth?.callbackUrl),
    metadata_scopes: scopes ?? [],
    pkce_required: booleanValue(globalOauth?.isPkceRequired),
    consumer_secret_optional: booleanValue(globalOauth?.isConsumerSecretOptional),
    named_user_jwt: booleanValue(globalOauth?.isNamedUserJwtEnabled),
    refresh_token_rotation: booleanValue(globalOauth?.isRefreshTokenRotationEnabled),
  };
}

export async function deployEcaSources(input: {
  session: SalesforceSession;
  sources: DeployableMetadataSource[];
  checkOnly: boolean;
  signal?: AbortSignal;
}): Promise<IntegrationDeploymentResult> {
  const root = await mkdtemp(path.join(tmpdir(), "sf-integrate-eca-"));
  try {
    for (const component of input.sources) {
      const directory = path.join(root, component.directory);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, component.filename), component.source, "utf8");
    }
    const { ComponentSet } = await import("@salesforce/source-deploy-retrieve");
    const components = ComponentSet.fromSource(root);
    components.apiVersion = input.session.target.apiVersion;
    components.sourceApiVersion = input.session.target.apiVersion;
    const job = await withTimeout(
      () =>
        components.deploy({
          usernameOrConnection: input.session.connection,
          apiOptions: {
            checkOnly: input.checkOnly,
            rollbackOnError: true,
            testLevel: "NoTestRun",
          },
        }),
      DEPLOY_START_TIMEOUT_MS,
      "External Client App deployment start",
      input.signal,
    );
    const result = await withTimeout(
      () => job.pollStatus(DEPLOY_POLL_FREQUENCY_MS, DEPLOY_POLL_TIMEOUT_MS / 1_000),
      DEPLOY_POLL_TIMEOUT_MS,
      "External Client App deployment poll",
      input.signal,
      () => job.cancel?.(),
    );
    const response = result.response;
    const rawFailures = response.details?.componentFailures as unknown;
    const failures = rawFailures ? (Array.isArray(rawFailures) ? rawFailures : [rawFailures]) : [];
    return {
      id: response.id,
      success: response.success === true,
      status: response.status,
      check_only: input.checkOnly,
      component_failures: failures.map(normalizeFailure),
      raw: response,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function resolveContactEmail(session: SalesforceSession): Promise<string | undefined> {
  const identity = await session.identity();
  if (!/^[A-Za-z0-9]{15,18}$/u.test(identity.user_id)) return undefined;
  const result = await session.query<{ Email?: string }>({
    soql: `SELECT Email FROM User WHERE Id = '${identity.user_id}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  return validEmail(result.records[0]?.Email) ? result.records[0]?.Email : undefined;
}

/** E2E-only deterministic cleanup for disposable External Client Apps. */
export async function deleteEcaStack(session: SalesforceSession, appName: string): Promise<void> {
  assertNonProduction(session);
  const metadata = session.connection.metadata as unknown as MetadataClient;
  const inspection = await inspectEca(session, appName);
  for (const type of [
    "ExtlClntAppGlobalOauthSettings",
    "ExtlClntAppOauthSettings",
    "ExternalClientApplication",
  ] as const) {
    if (!inspection.components[type]) continue;
    const result = await metadata.delete(type, [appName]);
    const rows = Array.isArray(result) ? result : [result];
    const failures = rows.filter((row) => {
      if (!row || typeof row !== "object") return true;
      return (row as { success?: unknown }).success !== true;
    });
    if (failures.length > 0) throw new Error(`Unable to delete disposable ${type}:${appName}.`);
  }
}

export function missingRequiredMetadataTypes(available: ReadonlySet<string>): string[] {
  return ECA_METADATA_TYPES.filter((type) => !available.has(type));
}

export function isCompleteEca(inspection: EcaInspection): boolean {
  return ECA_METADATA_TYPES.every((type) => inspection.components[type]);
}

async function readComponent(
  session: SalesforceSession,
  type: EcaMetadataType,
  appName: string,
): Promise<Record<string, unknown> | undefined> {
  const metadata = session.connection.metadata as unknown as MetadataClient;
  const response = await metadata.read(type, [appName]);
  const candidate = (Array.isArray(response) ? response[0] : response) as unknown;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  return record.fullName === appName ? record : undefined;
}

function normalizeFailure(
  value: unknown,
): IntegrationDeploymentResult["component_failures"][number] {
  const failure = (value ?? {}) as Record<string, unknown>;
  return {
    problem: String(failure.problem ?? "Unknown External Client App deployment failure"),
    full_name: stringValue(failure.fullName),
    component_type: stringValue(failure.componentType),
    line_number: numberValue(failure.lineNumber),
    column_number: numberValue(failure.columnNumber),
  };
}

function assertNonProduction(session: SalesforceSession): void {
  if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
    throw new Error("Disposable External Client App cleanup refuses production or unknown orgs.");
  }
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
  cancel?: () => void | Promise<void>,
): Promise<T> {
  if (signal?.aborted) throw new Error(`${label} aborted`);
  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        const stop = () => {
          void cancel?.();
          reject(new Error(`${label} timed out or was aborted`));
        };
        timer = setTimeout(stop, timeoutMs);
        if (signal) {
          abortHandler = stop;
          signal.addEventListener("abort", stop, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
}
