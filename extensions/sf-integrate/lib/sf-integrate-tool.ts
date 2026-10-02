/* SPDX-License-Identifier: Apache-2.0 */
/** Single SF Integrate family tool registration. */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { connectSalesforce } from "../../../lib/common/sf-conn/index.ts";
import { integrationErrorResult } from "./errors.ts";
import { applyInboundSetup, designInboundPlan, verifyInboundSetup } from "./inbound-operations.ts";
import {
  applySetup,
  designPlan,
  mcpHandoff,
  orgPreflight,
  status,
  verifySetup,
} from "./operations.ts";
import {
  applyOutboundSetup,
  authorizeOutboundOAuth,
  designOutboundPlan,
  populateOutboundSecretOperation,
  testOutboundConnection,
  verifyOutboundSetup,
} from "./outbound-operations.ts";
import { renderIntegrationCall, renderIntegrationResult } from "./render.ts";
import { resolveSecretInput } from "./secrets.ts";
import {
  ECA_OAUTH_FLOWS,
  OUTBOUND_AUTH_TYPES,
  SF_INTEGRATE_ACTIONS,
  type SfIntegrateParams,
  type SfIntegrateSessionState,
  type ToolResult,
} from "./types.ts";

export const SF_INTEGRATE_TOOL_NAME = "sf_integrate";

const Params = Type.Object({
  action: StringEnum(SF_INTEGRATE_ACTIONS, { description: "SF Integrate lifecycle action." }),
  target_org: Type.Optional(
    Type.String({ description: "Explicit Salesforce org alias or username." }),
  ),
  direction: Type.Optional(
    StringEnum(["mcp", "inbound", "outbound"] as const, {
      description: "Integration direction. Defaults to mcp for backward compatibility.",
    }),
  ),
  mcp_preset: Type.Optional(
    StringEnum(["headless-360"] as const, {
      description: "Supported Salesforce-hosted MCP preset. Phase 1 supports headless-360.",
    }),
  ),
  app_name: Type.Optional(
    Type.String({ description: "External Client App API name. Defaults to SfPiHeadless360Mcp." }),
  ),
  app_label: Type.Optional(
    Type.String({ description: "External Client App label. Defaults to SF Pi Headless 360 MCP." }),
  ),
  contact_email: Type.Optional(
    Type.String({
      description:
        "External Client App contact email. Defaults to the authenticated Salesforce user's email.",
    }),
  ),
  eca_flow: Type.Optional(
    StringEnum(ECA_OAUTH_FLOWS, {
      description: "Generic inbound External Client App OAuth flow profile.",
    }),
  ),
  callback_url: Type.Optional(
    Type.String({ description: "Absolute OAuth callback URI for direction=inbound." }),
  ),
  oauth_scopes: Type.Optional(
    Type.Array(Type.String(), { description: "Metadata OAuth scope names for the ECA." }),
  ),
  client_credentials_user: Type.Optional(
    Type.String({ description: "Salesforce execution username for ECA Client Credentials." }),
  ),
  certificate_file: Type.Optional(
    Type.String({ description: "Workspace-contained PEM public certificate for ECA JWT Bearer." }),
  ),
  eca_permission_set: Type.Optional(
    Type.String({ description: "Existing Permission Set API name for JWT pre-authorization." }),
  ),
  token_exchange_require_secret: Type.Optional(
    Type.Boolean({ description: "Require the ECA consumer secret for token exchange." }),
  ),
  token_exchange_handler: Type.Optional(
    Type.String({ description: "OauthTokenExchangeHandler developer name." }),
  ),
  token_exchange_apex: Type.Optional(
    Type.String({ description: "Existing Apex class extending Auth.Oauth2TokenExchangeHandler." }),
  ),
  token_exchange_user: Type.Optional(
    Type.String({ description: "Salesforce username that executes the token exchange handler." }),
  ),
  plan_id: Type.Optional(Type.String({ description: "Exact plan ID returned by design.plan." })),
  plan_hash: Type.Optional(
    Type.String({ description: "Exact source-bound plan hash returned by design.plan." }),
  ),
  allow_mutation: Type.Optional(
    Type.Boolean({
      description:
        "Required execution-intent flag for setup.apply, secret.populate, and oauth.authorize; Guardrail approval remains separate.",
    }),
  ),
  auth_type: Type.Optional(
    StringEnum(OUTBOUND_AUTH_TYPES, {
      description: "Outbound authentication model for direction=outbound.",
    }),
  ),
  endpoint_url: Type.Optional(
    Type.String({ description: "HTTPS callout base URL for the Named Credential." }),
  ),
  token_url: Type.Optional(
    Type.String({ description: "HTTPS OAuth token endpoint for outbound OAuth flows." }),
  ),
  authorize_url: Type.Optional(
    Type.String({ description: "HTTPS OAuth authorization endpoint for browser flow." }),
  ),
  scope: Type.Optional(Type.String({ description: "Provider-specific OAuth scope string." })),
  external_credential_name: Type.Optional(
    Type.String({ description: "External Credential developer name." }),
  ),
  named_credential_name: Type.Optional(
    Type.String({ description: "Named Credential developer name." }),
  ),
  identity_provider_name: Type.Optional(
    Type.String({ description: "External Auth Identity Provider name for OAuth browser flow." }),
  ),
  principal_name: Type.Optional(
    Type.String({ description: "External Credential principal name." }),
  ),
  principal_type: Type.Optional(
    StringEnum(["NamedPrincipal", "PerUserPrincipal"] as const, {
      description: "External Credential principal type.",
    }),
  ),
  permission_set_name: Type.Optional(
    Type.String({ description: "Permission Set API name used for principal access." }),
  ),
  assign_to_current_user: Type.Optional(
    Type.Boolean({ description: "Assign the generated Permission Set to the current user." }),
  ),
  signing_certificate: Type.Optional(
    Type.String({ description: "Existing Salesforce signing certificate developer name." }),
  ),
  jwt_issuer: Type.Optional(Type.String({ description: "Literal JWT iss claim." })),
  jwt_subject: Type.Optional(Type.String({ description: "Literal JWT sub claim." })),
  jwt_audience: Type.Optional(Type.String({ description: "Literal JWT aud claim." })),
  api_key_header: Type.Optional(
    Type.String({ description: "HTTP header that carries the API key for auth_type=api_key." }),
  ),
  secret_source: Type.Optional(
    StringEnum(["prompt", "env"] as const, {
      description: "Secret source. Raw secret values are never accepted as tool arguments.",
    }),
  ),
  secret_env: Type.Optional(
    Type.String({ description: "Environment variable name when secret_source=env." }),
  ),
  client_id: Type.Optional(
    Type.String({ description: "Public OAuth client identifier for secret.populate." }),
  ),
  test_path: Type.Optional(
    Type.String({ description: "Relative GET path for connection.test. Defaults to /." }),
  ),
  output_mode: Type.Optional(
    StringEnum(["summary", "inline", "file_only"] as const, {
      description: "Reserved output mode for future richer output.",
    }),
  ),
});

export interface SfIntegrateToolDependencies {
  promptSecret(signal?: AbortSignal): Promise<string>;
}

export function registerSfIntegrateTool(
  pi: ExtensionAPI,
  dependencies?: SfIntegrateToolDependencies,
): void {
  const state: SfIntegrateSessionState = {
    plans: new Map(),
    inboundPlans: new Map(),
    outboundPlans: new Map(),
  };
  pi.registerTool<typeof Params>({
    name: SF_INTEGRATE_TOOL_NAME,
    label: "SF Integrate",
    description:
      "Plan, apply, populate, authorize, verify, and test Salesforce integration authentication. Supports Headless 360, the core inbound External Client App OAuth matrix, and modern outbound External Credentials and Named Credentials in explicit non-production orgs.",
    promptSnippet:
      "Set up Salesforce hosted MCP OAuth, generic inbound ECA OAuth profiles, and outbound Named Credential stacks with plan-bound changes and compact proof.",
    promptGuidelines: [
      "Use direction=mcp for Salesforce-side Headless 360 OAuth setup; sf_mcp remains the owner of Pi MCP configuration, exposure, connections, and tokens.",
      "Use direction=inbound with eca_flow for Authorization Code, PKCE, Client Credentials, Device, JWT Bearer, or Token Exchange ECA profiles. Run plan, check-only-backed apply, then exact readback verification.",
      "Use direction=outbound for modern External Credential + Named Credential stacks. Run design.plan, setup.apply, secret.populate when required, setup.verify, then a GET-only connection.test.",
      "Every org-backed action requires an explicit target_org. Mutations require allow_mutation=true, remain Guardrail-mediated, and refuse production or unknown orgs.",
      "Never pass secret values in tool arguments. secret.populate accepts only a masked TUI prompt or an environment-variable name.",
      "Use OAuth browser consent only after principal access and identity-provider credentials are configured. Salesforce stores the resulting tokens.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderIntegrationCall(args as SfIntegrateParams, theme),
    renderResult: (result, options, theme) =>
      renderIntegrationResult(result as ToolResult, options, theme),
    async execute(_id, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SfIntegrateParams;
      try {
        if (params.action === "status") return status();
        if (!params.target_org?.trim()) {
          throw new Error(`${params.action} requires an explicit target_org.`);
        }
        const session = await connectSalesforce({
          cwd: ctx.cwd,
          targetOrg: params.target_org,
          signal,
        });
        const outbound =
          params.direction === "outbound" ||
          (params.plan_id ? state.outboundPlans.has(params.plan_id) : false) ||
          params.action === "connection.test";
        const inbound =
          params.direction === "inbound" ||
          (params.plan_id ? state.inboundPlans.has(params.plan_id) : false);
        switch (params.action) {
          case "org.preflight":
            return orgPreflight(params, session);
          case "design.plan":
            return outbound
              ? designOutboundPlan(params, session, state)
              : inbound
                ? designInboundPlan(params, session, state, ctx.cwd)
                : designPlan(params, session, state);
          case "setup.apply":
            return outbound
              ? applyOutboundSetup(params, session, state, signal)
              : inbound
                ? applyInboundSetup(params, session, state, undefined, signal)
                : applySetup(params, session, state, undefined, signal);
          case "secret.populate": {
            if (!dependencies) {
              throw new Error("Secure secret entry is unavailable in this runtime.");
            }
            const secret = await resolveSecretInput(params, dependencies.promptSecret, signal);
            return populateOutboundSecretOperation(params, session, state, secret, signal);
          }
          case "oauth.authorize":
            return authorizeOutboundOAuth(params, session, state, signal);
          case "setup.verify":
            return outbound
              ? verifyOutboundSetup(params, session, state)
              : inbound
                ? verifyInboundSetup(params, session, state)
                : verifySetup(params, session);
          case "connection.test":
            return testOutboundConnection(params, session, (body) =>
              ctx.executeTool(
                "sf_apex",
                {
                  action: "anon.run",
                  target_org: params.target_org,
                  body,
                  allow_mutation: false,
                  output_mode: "summary",
                },
                { signal },
              ),
            );
          case "mcp.handoff":
            return mcpHandoff(params, session);
          default:
            throw new Error(`Unsupported sf_integrate action: ${params.action}`);
        }
      } catch (error) {
        return integrationErrorResult(params, error);
      }
    },
  });
}
