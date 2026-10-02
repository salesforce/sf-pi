/* SPDX-License-Identifier: Apache-2.0 */
/** Shared SF Integrate contracts. */

import type { SfPiResultCard } from "../../../lib/common/display/result-card.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type { SfIntegrateMcpPresetId } from "../../../lib/common/sf-mcp-oauth-requirements.ts";

export const SF_INTEGRATE_ACTIONS = [
  "status",
  "org.preflight",
  "design.plan",
  "setup.apply",
  "secret.populate",
  "oauth.authorize",
  "setup.verify",
  "connection.test",
  "mcp.handoff",
] as const;

export const ECA_OAUTH_FLOWS = [
  "authorization_code",
  "authorization_code_pkce",
  "client_credentials",
  "device",
  "jwt_bearer",
  "token_exchange",
] as const;

export const OUTBOUND_AUTH_TYPES = [
  "oauth_client_credentials",
  "oauth_jwt_bearer",
  "oauth_browser",
  "api_key",
] as const;

export type SfIntegrateAction = (typeof SF_INTEGRATE_ACTIONS)[number];
export type SfIntegrateOutputMode = "summary" | "inline" | "file_only";
export type IntegrationDirection = "mcp" | "inbound" | "outbound";
export type EcaOauthFlow = (typeof ECA_OAUTH_FLOWS)[number];
export type OutboundAuthType = (typeof OUTBOUND_AUTH_TYPES)[number];
export type PrincipalType = "NamedPrincipal" | "PerUserPrincipal";
export type SecretSource = "prompt" | "env";

export interface SfIntegrateParams {
  action: SfIntegrateAction;
  target_org?: string;
  direction?: IntegrationDirection;
  mcp_preset?: SfIntegrateMcpPresetId;
  app_name?: string;
  app_label?: string;
  contact_email?: string;
  eca_flow?: EcaOauthFlow;
  callback_url?: string;
  oauth_scopes?: string[];
  client_credentials_user?: string;
  certificate_file?: string;
  eca_permission_set?: string;
  token_exchange_require_secret?: boolean;
  token_exchange_handler?: string;
  token_exchange_apex?: string;
  token_exchange_user?: string;
  plan_id?: string;
  plan_hash?: string;
  allow_mutation?: boolean;
  output_mode?: SfIntegrateOutputMode;

  auth_type?: OutboundAuthType;
  endpoint_url?: string;
  token_url?: string;
  authorize_url?: string;
  scope?: string;
  external_credential_name?: string;
  named_credential_name?: string;
  identity_provider_name?: string;
  principal_name?: string;
  principal_type?: PrincipalType;
  permission_set_name?: string;
  assign_to_current_user?: boolean;
  signing_certificate?: string;
  jwt_issuer?: string;
  jwt_subject?: string;
  jwt_audience?: string;
  api_key_header?: string;
  secret_source?: SecretSource;
  secret_env?: string;
  client_id?: string;
  test_path?: string;
}

export interface DeployableMetadataSource {
  directory: string;
  filename: string;
  source: string;
}

export type IntegrationMetadataType = EcaMetadataType | "OauthTokenExchangeHandler";

export interface IntegrationMetadataSource extends DeployableMetadataSource {
  type: IntegrationMetadataType;
}

export const ECA_METADATA_TYPES = [
  "ExternalClientApplication",
  "ExtlClntAppGlobalOauthSettings",
  "ExtlClntAppOauthSettings",
  "ExtlClntAppOauthConfigurablePolicies",
] as const;

export type EcaMetadataType = (typeof ECA_METADATA_TYPES)[number];

export interface IntegrationPlan {
  schema_version: 1;
  plan_id: string;
  plan_hash: string;
  created_at: string;
  preset: SfIntegrateMcpPresetId;
  app_name: string;
  app_label: string;
  contact_email: string;
  target: IntegrationPlanTarget;
  callback_url: string;
  metadata_scopes: string[];
  oauth_scopes: string[];
  sources: IntegrationMetadataSource[];
  artifact_path?: string;
}

export interface IntegrationPlanTarget {
  target_org: string;
  alias?: string;
  org_id: string;
  org_type: string;
  api_version: string;
}

export interface OutboundIntegrationPlan {
  schema_version: 1;
  plan_id: string;
  plan_hash: string;
  created_at: string;
  direction: "outbound";
  auth_type: OutboundAuthType;
  target: IntegrationPlanTarget;
  endpoint_url: string;
  external_credential_name: string;
  named_credential_name: string;
  principal_name: string;
  principal_type: PrincipalType;
  permission_set_name: string;
  assign_to_current_user: boolean;
  identity_provider_name?: string;
  external_auth_identity_provider?: Record<string, unknown>;
  external_credential?: Record<string, unknown>;
  external_credential_source?: DeployableMetadataSource;
  named_credential: Record<string, unknown>;
  credential_shape: string[];
  artifact_path?: string;
}

export interface EcaInspection {
  app_name: string;
  components: Record<EcaMetadataType, boolean>;
  application?: Record<string, unknown>;
  global_oauth?: Record<string, unknown>;
  oauth?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  token_exchange_handler?: Record<string, unknown>;
  consumer_key?: string;
  callback_url?: string;
  metadata_scopes: string[];
  pkce_required?: boolean;
  consumer_secret_optional?: boolean;
  named_user_jwt?: boolean;
  refresh_token_rotation?: boolean;
  secret_required_for_refresh_token?: boolean;
  client_credentials_enabled?: boolean;
  device_flow_enabled?: boolean;
  token_exchange_enabled?: boolean;
  token_exchange_secret_required?: boolean;
  certificate_present?: boolean;
  client_credentials_user?: string;
  permitted_users_policy?: string;
}

export interface InboundIntegrationPlan {
  schema_version: 1;
  plan_id: string;
  plan_hash: string;
  created_at: string;
  direction: "inbound";
  eca_flow: EcaOauthFlow;
  app_name: string;
  app_label: string;
  contact_email: string;
  target: IntegrationPlanTarget;
  callback_url: string;
  metadata_scopes: string[];
  sources: IntegrationMetadataSource[];
  expected: {
    consumer_secret_optional: boolean;
    pkce_required: boolean;
    secret_required_for_refresh_token: boolean;
    client_credentials_enabled: boolean;
    device_flow_enabled: boolean;
    token_exchange_enabled: boolean;
    token_exchange_secret_required: boolean;
    certificate_present: boolean;
    client_credentials_user?: string;
    permitted_users_policy: string;
    token_exchange_handler?: string;
    token_exchange_apex?: string;
    token_exchange_user?: string;
  };
  artifact_path?: string;
}

export interface OutboundInspection {
  external_credential_name: string;
  named_credential_name: string;
  permission_set_name: string;
  identity_provider_name?: string;
  external_credential?: Record<string, unknown>;
  named_credential?: Record<string, unknown>;
  identity_provider?: Record<string, unknown>;
  credential?: Record<string, unknown>;
  permission_set_id?: string;
  principal_id?: string;
  principal_access_id?: string;
  permission_assignment_id?: string;
}

export interface IntegrationDeploymentResult {
  id?: string;
  success: boolean;
  status?: string;
  check_only: boolean;
  component_failures: Array<{
    problem: string;
    full_name?: string;
    component_type?: string;
    line_number?: number;
    column_number?: number;
  }>;
  raw: unknown;
}

export interface IntegrationArtifact {
  path: string;
  kind: string;
}

export interface SfIntegrateSessionState {
  plans: Map<string, IntegrationPlan>;
  inboundPlans: Map<string, InboundIntegrationPlan>;
  outboundPlans: Map<string, OutboundIntegrationPlan>;
}

export interface IntegrationAdapter {
  describeMetadataTypes(session: SalesforceSession): Promise<Set<string>>;
  inspectEca(session: SalesforceSession, appName: string): Promise<EcaInspection>;
  deploy(input: {
    session: SalesforceSession;
    sources: DeployableMetadataSource[];
    checkOnly: boolean;
    signal?: AbortSignal;
  }): Promise<IntegrationDeploymentResult>;
  resolveContactEmail(session: SalesforceSession): Promise<string | undefined>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: {
    ok: boolean;
    action: SfIntegrateAction;
    card?: SfPiResultCard;
    [key: string]: unknown;
  };
  isError?: boolean;
}
