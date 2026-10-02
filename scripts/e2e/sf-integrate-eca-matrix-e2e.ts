#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Core External Client App OAuth profile matrix with disposable live proof. */

import { execFile } from "node:child_process";
import { createSign, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import {
  applyInboundSetup,
  designInboundPlan,
  inboundVerificationFindings,
} from "../../extensions/sf-integrate/lib/inbound-operations.ts";
import {
  defaultIntegrationAdapter,
  deleteEcaStack,
  deleteTokenExchangeHandler,
} from "../../extensions/sf-integrate/lib/metadata.ts";
import type {
  EcaOauthFlow,
  InboundIntegrationPlan,
  SfIntegrateParams,
  SfIntegrateSessionState,
} from "../../extensions/sf-integrate/lib/types.ts";

const execFileAsync = promisify(execFile);
const SYNTHETIC_CLIENT_SECRET = "sf-pi-synthetic-client-secret-0123456789abcdef";
const SYNTHETIC_SUBJECT_TOKEN = createSyntheticSubjectToken();
const FLOWS: EcaOauthFlow[] = [
  "authorization_code",
  "authorization_code_pkce",
  "client_credentials",
  "device",
  "jwt_bearer",
  "token_exchange",
];

const args = process.argv.slice(2);
const targetOrg = flagValue(args, "--org");
const apply = args.includes("--apply");
const runtime = args.includes("--runtime");
const requestedFlow = flagValue(args, "--flow");
const flows = requestedFlow ? [parseFlow(requestedFlow)] : FLOWS;
if (!targetOrg) {
  throw new Error(
    "Usage: npm run e2e:sf-integrate-eca-matrix -- --org <non-production-alias> [--flow <core-flow>] [--apply] [--runtime]",
  );
}
if (runtime && !apply) throw new Error("--runtime requires --apply.");

const session = await connectSalesforce({ cwd: process.cwd(), targetOrg });
if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
  throw new Error(`ECA matrix refuses org type ${session.target.orgType}.`);
}
const username = session.target.username;
if (!username) throw new Error("The target connection did not provide a username.");
const userResult = await session.query<{ Id: string }>({
  soql: `SELECT Id FROM User WHERE Username = '${escapeSoqlLiteral(username)}' LIMIT 1`,
  api: "rest",
  maxRows: 1,
});
const userId = userResult.records[0]?.Id;
if (!userId) throw new Error("The authenticated Salesforce user wasn't found.");
const apiOnlyResult = await session.query<{ Username: string }>({
  soql: "SELECT Username FROM User WHERE IsActive = true AND Profile.PermissionsApiUserOnly = true LIMIT 1",
  api: "rest",
  maxRows: 1,
});
const apiOnlyUsername = apiOnlyResult.records[0]?.Username;
const temp = await mkdtemp(path.join(tmpdir(), "sf-integrate-eca-matrix-"));
const certPath = path.join(temp, "public.crt");
const keyPath = path.join(temp, "private.key");
await createCertificate(certPath, keyPath);
const permissionSetName = `SfPiEcaJwt${Date.now().toString(36)}`.slice(0, 70);
const tokenExchangeApex = `SfPiTokenApex${Date.now().toString(36)}`.slice(0, 70);
let tokenExchangeApexCreated = false;
let permissionSetId: string | undefined;
let permissionAssignmentId: string | undefined;
const createdPlans: InboundIntegrationPlan[] = [];
let runError: unknown;
let cleanupError: unknown;

console.log(`Target: ${session.target.alias ?? targetOrg} · ${session.target.orgType}`);
console.log(`API: ${session.target.apiVersion}`);
console.log(`Mode: ${runtime ? "runtime" : apply ? "apply" : "check-only"}`);

try {
  if (apply && (flows.includes("jwt_bearer") || flows.includes("token_exchange"))) {
    const created = await createJwtPermissionSet(permissionSetName, userId);
    permissionSetId = created.permissionSetId;
    permissionAssignmentId = created.assignmentId;
    console.log("✅ ECA pre-authorization fixture");
  }
  if (apply && flows.includes("token_exchange")) {
    await createTokenExchangeApex(tokenExchangeApex, userId);
    tokenExchangeApexCreated = true;
    console.log("✅ Token Exchange Apex fixture");
  }

  for (const flow of flows) {
    if (flow === "jwt_bearer" && !apply) {
      console.log("⏭ jwt_bearer check-only skipped · disposable permission set requires --apply");
      continue;
    }
    if (flow === "token_exchange" && !apply) {
      console.log("⏭ token_exchange check-only skipped · disposable Apex handler requires --apply");
      continue;
    }
    const suffix = `${Date.now().toString(36)}${flow.slice(0, 3)}`.replace(/[^A-Za-z0-9]/gu, "");
    const appName = `SfPiEcaE2E${suffix}`.slice(0, 70);
    const state: SfIntegrateSessionState = {
      plans: new Map(),
      inboundPlans: new Map(),
      outboundPlans: new Map(),
    };
    const params = profileParams({
      flow,
      targetOrg,
      appName,
      username,
      clientCredentialsUsername: apiOnlyUsername,
      certificateFile: path.basename(certPath),
      permissionSetName,
      tokenExchangeApex,
    });
    const planned = await designInboundPlan(params, session, state, temp);
    const planId = String(planned.details.plan_id);
    const planHash = String(planned.details.plan_hash);
    const plan = state.inboundPlans.get(planId);
    if (!plan) throw new Error(`No retained plan for ${flow}.`);

    const checkSources =
      flow === "token_exchange"
        ? plan.sources.filter((source) => source.type !== "OauthTokenExchangeHandler")
        : plan.sources;
    const check = await defaultIntegrationAdapter.deploy({
      session,
      sources: checkSources,
      checkOnly: true,
    });
    if (!check.success) {
      throw new Error(
        `${flow} check-only failed: ${check.component_failures.map((failure) => failure.problem).join("; ")}`,
      );
    }
    console.log(`✅ ${flow} check-only`);

    if (!apply) continue;
    if (runtime && flow === "client_credentials") {
      const sources = withSyntheticConsumerSecret(plan, SYNTHETIC_CLIENT_SECRET);
      const secretCheck = await defaultIntegrationAdapter.deploy({
        session,
        sources,
        checkOnly: true,
      });
      if (!secretCheck.success) {
        throw new Error(
          `Client Credentials secret check-only failed: ${secretCheck.component_failures.map((failure) => failure.problem).join("; ")}`,
        );
      }
      const deployed = await defaultIntegrationAdapter.deploy({
        session,
        sources,
        checkOnly: false,
      });
      if (!deployed.success) {
        throw new Error(
          `Client Credentials deployment failed: ${deployed.component_failures.map((failure) => failure.problem).join("; ")}`,
        );
      }
      createdPlans.push(plan);
      const inspection = await defaultIntegrationAdapter.inspectEca(session, plan.app_name);
      const findings = inboundVerificationFindings(plan, inspection);
      if (findings.length) throw new Error(`Client Credentials readback: ${findings.join("; ")}`);
    } else {
      const applied = await applyInboundSetup(
        {
          ...params,
          action: "setup.apply",
          app_name: appName,
          plan_id: planId,
          plan_hash: planHash,
          allow_mutation: true,
        },
        session,
        state,
      );
      createdPlans.push(plan);
      if (!applied.details.ok) {
        throw new Error(applied.content[0]?.text ?? `${flow} apply failed`);
      }
    }
    console.log(`✅ ${flow} deploy + readback`);

    if (runtime) {
      const proof = await runtimeProof(flow, plan, keyPath, SYNTHETIC_CLIENT_SECRET);
      console.log(`${proof.complete ? "✅" : "⏳"} ${flow} ${proof.detail}`);
    }
  }
} catch (error) {
  runError = error;
} finally {
  if (apply) {
    try {
      for (const plan of [...createdPlans].reverse()) {
        if (plan.expected.token_exchange_handler) {
          await deleteTokenExchangeHandler(session, plan.expected.token_exchange_handler);
        }
        await deleteEcaStack(session, plan.app_name);
      }
      if (tokenExchangeApexCreated) {
        await deleteApexClass(tokenExchangeApex);
      }
      if (permissionAssignmentId) {
        await remove(`/sobjects/PermissionSetAssignment/${permissionAssignmentId}`);
      }
      if (permissionSetId) await remove(`/sobjects/PermissionSet/${permissionSetId}`);
      console.log("✅ matrix cleanup");
    } catch (error) {
      cleanupError = error;
    }
  }
  await rm(temp, { recursive: true, force: true });
}

if (runError && cleanupError) {
  throw new AggregateError([runError, cleanupError], "ECA matrix and cleanup both failed.");
}
if (runError) throw runError;
if (cleanupError) throw cleanupError;

async function runtimeProof(
  flow: EcaOauthFlow,
  plan: InboundIntegrationPlan,
  privateKeyPath: string,
  clientSecret: string,
): Promise<{ complete: boolean; detail: string }> {
  const inspection = await defaultIntegrationAdapter.inspectEca(session, plan.app_name);
  const clientId = inspection.consumer_key;
  if (!clientId) return { complete: false, detail: "consumer key pending propagation" };
  const baseUrl = session.target.instanceUrl.replace(/\/$/u, "");

  if (flow === "authorization_code" || flow === "authorization_code_pkce") {
    const url = new URL(`${baseUrl}/services/oauth2/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", plan.callback_url);
    if (plan.expected.pkce_required) {
      url.searchParams.set("code_challenge", base64url(randomBytes(32)));
      url.searchParams.set("code_challenge_method", "S256");
    }
    const response = await fetch(url, { redirect: "manual" });
    return {
      complete: response.status >= 200 && response.status < 400,
      detail: `authorization endpoint responded HTTP ${response.status}`,
    };
  }

  if (flow === "device") {
    const response = await postForm(`${baseUrl}/services/oauth2/token`, {
      response_type: "device_code",
      client_id: clientId,
    });
    const complete = response.ok && hasString(response.body, "device_code");
    return {
      complete,
      detail: complete
        ? "device-code issuance"
        : `device-code pending or rejected · ${safeOAuthError(response.body)}`,
    };
  }

  if (flow === "jwt_bearer") {
    const privateKey = await readFile(privateKeyPath, "utf8");
    const now = Math.floor(Date.now() / 1_000);
    const assertion = signJwt(
      {
        iss: clientId,
        sub: username,
        aud: baseUrl,
        exp: now + 180,
        nbf: now,
        jti: randomUUID(),
      },
      privateKey,
    );
    const response = await postForm(`${baseUrl}/services/oauth2/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    await revokeIfPresent(baseUrl, response.body);
    return {
      complete: response.ok && hasString(response.body, "access_token"),
      detail: response.ok
        ? "JWT access-token exchange"
        : `JWT exchange pending or rejected · ${safeOAuthError(response.body)}`,
    };
  }

  if (flow === "client_credentials") {
    const retrievedSecret = inspection.global_oauth?.consumerSecret;
    const effectiveSecret =
      typeof retrievedSecret === "string" && retrievedSecret ? retrievedSecret : clientSecret;
    const response = await postForm(`${baseUrl}/services/oauth2/token`, {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: effectiveSecret,
    });
    await revokeIfPresent(baseUrl, response.body);
    return {
      complete: response.ok && hasString(response.body, "access_token"),
      detail: response.ok
        ? "client-credentials access-token exchange"
        : `client-credentials exchange pending or rejected · ${safeOAuthError(response.body)}`,
    };
  }

  const response = await postForm(`${baseUrl}/services/oauth2/token`, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: clientId,
    subject_token: SYNTHETIC_SUBJECT_TOKEN,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  });
  await revokeIfPresent(baseUrl, response.body);
  const error = safeOAuthError(response.body);
  return {
    complete: response.ok || !/unsupported_grant_type|invalid_client_id/iu.test(error),
    detail: response.ok
      ? "token exchange accepted"
      : `flow recognized; synthetic subject token rejected · ${error}`,
  };
}

function withSyntheticConsumerSecret(plan: InboundIntegrationPlan, secret: string) {
  return plan.sources.map((source) => {
    if (source.type !== "ExtlClntAppGlobalOauthSettings") return source;
    return {
      ...source,
      source: source.source.replace(
        "    <externalClientApplication>",
        `    <consumerSecret>${escapeXml(secret)}</consumerSecret>\n    <externalClientApplication>`,
      ),
    };
  });
}

async function createTokenExchangeApex(className: string, userId: string): Promise<void> {
  const sources = [
    {
      directory: "classes",
      filename: `${className}.cls`,
      source: `global without sharing class ${className} extends Auth.Oauth2TokenExchangeHandler {
    global override Auth.TokenValidationResult validateIncomingToken(
        String appDeveloperName,
        Auth.IntegratingAppType appType,
        String incomingToken,
        Auth.OAuth2TokenExchangeType tokenType
    ) {
        Boolean valid = incomingToken == '${SYNTHETIC_SUBJECT_TOKEN}' &&
            tokenType == Auth.OAuth2TokenExchangeType.JWT;
        return valid
            ? new Auth.TokenValidationResult(true, null, null, incomingToken, tokenType, null)
            : new Auth.TokenValidationResult(false);
    }

    global override User getUserForTokenSubject(
        Id networkId,
        Auth.TokenValidationResult result,
        Boolean canCreateUser,
        String appDeveloperName,
        Auth.IntegratingAppType appType
    ) {
        return [SELECT Id FROM User WHERE Id = '${userId}' LIMIT 1];
    }
}
`,
    },
    {
      directory: "classes",
      filename: `${className}.cls-meta.xml`,
      source: `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>67.0</apiVersion>
    <status>Active</status>
</ApexClass>
`,
    },
  ];
  const check = await defaultIntegrationAdapter.deploy({ session, sources, checkOnly: true });
  if (!check.success) {
    throw new Error(
      `Token Exchange Apex check-only failed: ${check.component_failures.map((failure) => failure.problem).join("; ")}`,
    );
  }
  const deployed = await defaultIntegrationAdapter.deploy({
    session,
    sources,
    checkOnly: false,
  });
  if (!deployed.success) {
    throw new Error(
      `Token Exchange Apex deployment failed: ${deployed.component_failures.map((failure) => failure.problem).join("; ")}`,
    );
  }
}

async function deleteApexClass(name: string): Promise<void> {
  const result = await session.query<{ Id: string }>({
    soql: `SELECT Id FROM ApexClass WHERE Name = '${escapeSoqlLiteral(name)}' LIMIT 1`,
    api: "tooling",
    maxRows: 1,
  });
  const id = result.records[0]?.Id;
  if (!id) return;
  const response = await session.request({
    method: "DELETE",
    path: `/tooling/sobjects/ApexClass/${id}`,
  });
  if (response.status >= 400 && response.status !== 404) {
    throw new Error(`Unable to delete disposable ApexClass:${name}.`);
  }
}

async function createJwtPermissionSet(
  name: string,
  userId: string,
): Promise<{ permissionSetId: string; assignmentId: string }> {
  const created = await post("/sobjects/PermissionSet", {
    Name: name,
    Label: `${name} Access`,
    Description: "Disposable JWT ECA pre-authorization proof.",
  });
  const permissionSetId = requireId(created, "PermissionSet");
  const assignment = await post("/sobjects/PermissionSetAssignment", {
    AssigneeId: userId,
    PermissionSetId: permissionSetId,
  });
  return {
    permissionSetId,
    assignmentId: requireId(assignment, "PermissionSetAssignment"),
  };
}

async function post(resource: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await session.request<Record<string, unknown>>({
    method: "POST",
    path: resource,
    body,
  });
  if (response.status >= 400) throw new Error(`POST ${resource} failed (${response.status}).`);
  return response.body;
}

async function remove(resource: string): Promise<void> {
  const response = await session.request({ method: "DELETE", path: resource });
  if (response.status >= 400 && response.status !== 404) {
    throw new Error(`DELETE ${resource} failed (${response.status}).`);
  }
}

function profileParams(input: {
  flow: EcaOauthFlow;
  targetOrg: string;
  appName: string;
  username: string;
  clientCredentialsUsername?: string;
  certificateFile: string;
  permissionSetName: string;
  tokenExchangeApex: string;
}): SfIntegrateParams {
  return {
    action: "design.plan",
    direction: "inbound",
    target_org: input.targetOrg,
    eca_flow: input.flow,
    app_name: input.appName,
    app_label: `SF Pi ECA ${input.flow}`.slice(0, 80),
    contact_email: "admin@example.invalid",
    callback_url:
      input.flow === "device"
        ? "http://localhost:1717/OauthRedirect"
        : "https://example.invalid/oauth/callback",
    ...(input.flow === "client_credentials"
      ? {
          client_credentials_user: input.clientCredentialsUsername ?? missingApiOnlyUser(),
        }
      : {}),
    ...(input.flow === "jwt_bearer"
      ? {
          certificate_file: input.certificateFile,
          eca_permission_set: input.permissionSetName,
        }
      : {}),
    ...(input.flow === "token_exchange"
      ? {
          token_exchange_require_secret: false,
          eca_permission_set: input.permissionSetName,
          token_exchange_handler: `${input.appName}Handler`.slice(0, 80),
          token_exchange_apex: input.tokenExchangeApex,
          token_exchange_user: input.username,
        }
      : {}),
  };
}

async function createCertificate(certificatePath: string, privateKeyPath: string): Promise<void> {
  await execFileAsync("openssl", [
    "req",
    "-new",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    privateKeyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    "/CN=sf-pi-eca-e2e",
  ]);
}

async function postForm(
  url: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Keep response content out of console and artifacts.
  }
  return { ok: response.ok, status: response.status, body };
}

async function revokeIfPresent(baseUrl: string, body: Record<string, unknown>): Promise<void> {
  const token = body.access_token;
  if (typeof token !== "string" || !token) return;
  await fetch(`${baseUrl}/services/oauth2/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
}

function signJwt(payload: Record<string, unknown>, privateKey: string): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${base64url(signer.sign(privateKey))}`;
}

function createSyntheticSubjectToken(): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({ sub: "sf-pi-runtime-proof" })));
  return `${header}.${payload}.`;
}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function hasString(body: Record<string, unknown>, field: string): boolean {
  return typeof body[field] === "string" && Boolean(body[field]);
}

function safeOAuthError(body: Record<string, unknown>): string {
  const error = typeof body.error === "string" ? body.error : "unknown_error";
  const description =
    typeof body.error_description === "string" ? body.error_description : "no description";
  return `${error}: ${description}`.slice(0, 300);
}

function requireId(body: Record<string, unknown>, label: string): string {
  const id = body.id;
  if (typeof id !== "string" || !id) throw new Error(`${label} create returned no id.`);
  return id;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function escapeSoqlLiteral(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

function missingApiOnlyUser(): never {
  throw new Error("The target org has no active API Only user for Client Credentials proof.");
}

function parseFlow(value: string): EcaOauthFlow {
  if (!FLOWS.includes(value as EcaOauthFlow)) {
    throw new Error(`Unsupported ECA matrix flow: ${value}`);
  }
  return value as EcaOauthFlow;
}

function flagValue(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  const value = index >= 0 ? values[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}
