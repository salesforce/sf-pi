#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Plan-only by default; optional disposable modern outbound credential proof. */

import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import { runAnonymous } from "../../extensions/sf-apex/lib/anonymous.ts";
import { defaultIntegrationAdapter } from "../../extensions/sf-integrate/lib/metadata.ts";
import { deleteOutboundStack } from "../../extensions/sf-integrate/lib/outbound-api.ts";
import {
  applyOutboundSetup,
  authorizeOutboundOAuth,
  designOutboundPlan,
  populateOutboundSecretOperation,
  testOutboundConnection,
  verifyOutboundSetup,
} from "../../extensions/sf-integrate/lib/outbound-operations.ts";
import type {
  OutboundAuthType,
  SfIntegrateParams,
  SfIntegrateSessionState,
} from "../../extensions/sf-integrate/lib/types.ts";

const args = process.argv.slice(2);
const targetOrg = flagValue(args, "--org");
const apply = args.includes("--apply");
const authType = parseAuthType(flagValue(args, "--auth") ?? "api_key");
if (!targetOrg) {
  throw new Error(
    "Usage: npm run e2e:sf-integrate-outbound -- --org <non-production-alias> [--auth api_key|oauth_client_credentials|oauth_browser] [--apply]",
  );
}

const session = await connectSalesforce({ cwd: process.cwd(), targetOrg });
if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
  throw new Error(`SF Integrate outbound E2E refuses org type ${session.target.orgType}.`);
}

const suffix = Date.now()
  .toString(36)
  .replace(/[^A-Za-z0-9]/gu, "");
const baseName = `SfPiOutboundE2E${suffix}`.slice(0, 55);
const externalCredentialName = `${baseName}EC`;
const namedCredentialName = `${baseName}NC`;
const permissionSetName = `${baseName}Access`;
const identityProviderName = `${baseName}Idp`;
const state: SfIntegrateSessionState = {
  plans: new Map(),
  inboundPlans: new Map(),
  outboundPlans: new Map(),
};
let planId = "";
let runError: unknown;
let cleanupError: unknown;

console.log(`Target: ${session.target.alias ?? targetOrg} · ${session.target.orgType}`);
console.log(`API: ${session.target.apiVersion}`);
console.log(`Fixture: ${baseName} · ${authType}`);

try {
  const planned = await designOutboundPlan(
    planParams({
      authType,
      targetOrg,
      externalCredentialName,
      namedCredentialName,
      permissionSetName,
      identityProviderName,
    }),
    session,
    state,
  );
  planId = String(planned.details.plan_id);
  const planHash = String(planned.details.plan_hash);
  const plan = state.outboundPlans.get(planId);
  if (!plan) throw new Error("Outbound E2E plan was not retained.");
  console.log("✅ outbound plan");

  if (plan.external_credential_source) {
    const check = await defaultIntegrationAdapter.deploy({
      session,
      sources: [plan.external_credential_source],
      checkOnly: true,
    });
    if (!check.success) {
      throw new Error(
        `External Credential check-only failed: ${check.component_failures.map((failure) => failure.problem).join("; ")}`,
      );
    }
    console.log("✅ External Credential check-only");
  } else {
    console.log(
      "ℹ️ Connect REST has no check-only mode; exact create plan is the rehearsal boundary",
    );
  }

  if (!apply) {
    console.log("ℹ️ no configuration saved; pass --apply for the disposable lifecycle proof");
  } else {
    const binding: SfIntegrateParams = {
      action: "setup.apply",
      target_org: targetOrg,
      direction: "outbound",
      named_credential_name: namedCredentialName,
      plan_id: planId,
      plan_hash: planHash,
      allow_mutation: true,
    };
    const applied = await applyOutboundSetup(binding, session, state);
    if (!applied.details.ok) throw new Error(applied.content[0]?.text ?? "Apply failed");
    console.log("✅ outbound stack apply");

    const populated = await populateOutboundSecretOperation(
      {
        ...binding,
        action: "secret.populate",
        ...(authType === "api_key" ? {} : { client_id: "sf-pi-public-client" }),
      },
      session,
      state,
      authType === "api_key" ? "sf-pi-synthetic-api-key" : "sf-pi-synthetic-client-secret",
    );
    if (!populated.details.ok) {
      throw new Error(populated.content[0]?.text ?? "Secret population failed");
    }
    console.log("✅ secret-safe credential population");

    if (authType === "oauth_browser") {
      const authorization = await authorizeOutboundOAuth(
        { ...binding, action: "oauth.authorize" },
        session,
        state,
      );
      if (typeof authorization.details.authorization_url !== "string") {
        throw new Error("Browser OAuth proof returned no authorization URL.");
      }
      console.log("✅ OAuth consent URL generation");
    } else {
      const verified = await verifyOutboundSetup(
        { ...binding, action: "setup.verify", allow_mutation: undefined },
        session,
        state,
      );
      if (!verified.details.ok) throw new Error(verified.content[0]?.text ?? "Verify failed");
      console.log("✅ outbound verification");
    }

    if (authType === "api_key") {
      const tested = await testOutboundConnection(
        {
          action: "connection.test",
          target_org: targetOrg,
          direction: "outbound",
          named_credential_name: namedCredentialName,
          test_path: "/get?probe=sf-pi",
        },
        session,
        (body) =>
          runAnonymous(session, {
            action: "anon.run",
            target_org: targetOrg,
            body,
            allow_mutation: false,
            output_mode: "summary",
          }),
      );
      if (!tested.details.ok) throw new Error(tested.content[0]?.text ?? "Connection test failed");
      console.log("✅ bounded GET callout");
    }
  }
} catch (error) {
  runError = error;
} finally {
  if (apply && planId) {
    try {
      const plan = state.outboundPlans.get(planId);
      if (plan) await deleteOutboundStack(session, plan);
      console.log("✅ cleanup");
    } catch (error) {
      cleanupError = error;
    }
  }
}

if (runError && cleanupError) {
  throw new AggregateError(
    [runError, cleanupError],
    "SF Integrate outbound E2E and cleanup both failed.",
  );
}
if (runError) throw runError;
if (cleanupError) throw cleanupError;

function planParams(input: {
  authType: OutboundAuthType;
  targetOrg: string;
  externalCredentialName: string;
  namedCredentialName: string;
  permissionSetName: string;
  identityProviderName: string;
}): SfIntegrateParams {
  const common: SfIntegrateParams = {
    action: "design.plan",
    target_org: input.targetOrg,
    direction: "outbound",
    auth_type: input.authType,
    endpoint_url: "https://postman-echo.com",
    external_credential_name: input.externalCredentialName,
    named_credential_name: input.namedCredentialName,
    permission_set_name: input.permissionSetName,
    assign_to_current_user: true,
  };
  if (input.authType === "api_key") {
    return { ...common, api_key_header: "X-Api-Key", principal_name: "ApiKey" };
  }
  if (input.authType === "oauth_client_credentials") {
    return {
      ...common,
      token_url: "https://example.invalid/oauth/token",
      scope: "read",
      principal_name: "NamedPrincipal",
    };
  }
  return {
    ...common,
    token_url: "https://example.invalid/oauth/token",
    authorize_url: "https://example.invalid/oauth/authorize",
    scope: "read",
    identity_provider_name: input.identityProviderName,
    principal_name: "PerUserPrincipal",
    principal_type: "PerUserPrincipal",
  };
}

function parseAuthType(value: string): Exclude<OutboundAuthType, "oauth_jwt_bearer"> {
  if (value !== "api_key" && value !== "oauth_client_credentials" && value !== "oauth_browser") {
    throw new Error(`Unsupported E2E --auth value: ${value}`);
  }
  return value;
}

function flagValue(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  const value = index >= 0 ? values[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}
