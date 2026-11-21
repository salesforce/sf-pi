/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `sf_fin action='salesforce' operation='token_transfer'`: put an External
 * Client App's client credentials into a Fin OAuth auth token, so a data
 * connector can call Salesforce as the app's API-only run-as user.
 *
 * Fin's public auth-token API needs a write scope a personal token may not
 * have, and Salesforce shows the consumer secret only behind identity
 * verification. This runbook moves it without a human copy-paste and without
 * the secret ever reaching tool output, chat, or logs:
 *
 *   1. Turn on "Allow access to External Client App consumer secrets via REST
 *      API" (ExternalClientAppSettings.enableClientSecretInRestApiAccess),
 *      unless it is already on.
 *   2. Read the app's consumer key and secret from the credentials REST API.
 *   3. Fill Fin's Add token form (type OAuth, form-encoded, the org's token
 *      endpoint) and run Fin's Test request; save only when it passes.
 *   4. Turn the setting off again (when this runbook turned it on), on every
 *      path, and verify the API no longer returns the secret.
 *
 * Production and unknown orgs are refused here as well as by SF Guardrail.
 */

export interface TokenTransferOrg {
  /** My Domain host of the target org. */
  host: string;
  findApp(
    name: string,
  ): Promise<{ id: string; name: string; clientCredentials: boolean; runAs?: string } | undefined>;
  restSecretSetting(): Promise<boolean | undefined>;
  setRestSecretSetting(value: boolean): Promise<{ ok: boolean; error?: string }>;
  /** Consumer key and secret; undefined when the org does not return them. */
  readCredentials(appId: string): Promise<{ key: string; secret: string } | undefined>;
}

export interface TokenTransferBrowser {
  /** Open Fin's Add token → Custom form; false when it did not render. */
  openNewToken(): Promise<boolean>;
  fill(
    field: "name" | "description" | "url" | "clientId" | "clientSecret",
    value: string,
  ): Promise<void>;
  chooseOAuth(): Promise<void>;
  chooseFormEncoded(): Promise<void>;
  testRequest(): Promise<{ ok: boolean; message: string }>;
  save(): Promise<boolean>;
  listTokenNames(): Promise<string[]>;
  /** Leave Fin (about:blank) so no admin page stays open. */
  leave(): Promise<void>;
}

export interface TokenTransferInput {
  appName: string;
  tokenName: string;
  targetOrg: string;
  orgType: string;
  finBase: string;
  execute: boolean;
}

export interface TokenTransferResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

const PRODUCTION_LIKE = new Set(["production", "unknown"]);

export async function runTokenTransfer(
  org: TokenTransferOrg,
  fin: TokenTransferBrowser,
  input: TokenTransferInput,
): Promise<TokenTransferResult> {
  const base = { app: input.appName, token: input.tokenName };
  if (PRODUCTION_LIKE.has(input.orgType)) {
    return refused(
      "production",
      `token_transfer runs only on non-production orgs (${input.targetOrg} is ${input.orgType}). Copy the consumer secret into Fin by hand there.`,
      base,
    );
  }
  if (!input.execute) {
    return {
      ok: true,
      text: [
        `Plan: create Fin OAuth token "${input.tokenName}" from External Client App ${input.appName} in ${input.targetOrg}.`,
        `- Turn on "Allow access to External Client App consumer secrets via REST API" (unless already on).`,
        `- Read the app's consumer key and secret from the org's credentials API; they never leave the browser form.`,
        `- Fill Fin's Add token form: type OAuth, form-encoded, https://${org.host}/services/oauth2/token.`,
        `- Run Fin's Test request; save only when Salesforce returns an access token.`,
        `- Then it turns the setting off again (on every path) and verifies the secret is no longer readable.`,
        "",
        `To execute: sf_fin action='salesforce' operation='token_transfer' target_org='${input.targetOrg}' app_name='${input.appName}' token_name='${input.tokenName}' allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: { phase: "plan", ...base },
    };
  }

  const app = await org.findApp(input.appName);
  if (!app) {
    return refused(
      "app_not_found",
      `External Client App ${input.appName} not found in ${input.targetOrg}.`,
      base,
    );
  }
  if (!app.clientCredentials) {
    return refused(
      "no_client_credentials",
      `${input.appName} does not enable the client credentials flow; Fin's OAuth token needs it.`,
      base,
    );
  }
  if ((await fin.listTokenNames()).includes(input.tokenName)) {
    return refused(
      "token_name_taken",
      `Fin already has an auth token named "${input.tokenName}". Pass a different token_name, or delete the old one in Fin first.`,
      base,
    );
  }

  const steps: string[] = [];
  const wasOn = (await org.restSecretSetting()) === true;
  // True once SF Fin has *asked* to turn the setting on, even if the request
  // failed or timed out: a queued deploy can still apply it later.
  let turnedOn = false;
  let saved = false;
  let test: { ok: boolean; message: string } | undefined;
  let failure: string | undefined;
  try {
    if (wasOn) {
      steps.push("ℹ️ REST access to consumer secrets was already on; SF Fin leaves it on.");
    } else {
      turnedOn = true;
      const on = await org.setRestSecretSetting(true);
      if (!on.ok) throw new Error(`Could not turn on REST access to consumer secrets: ${on.error}`);
      steps.push("✅ Turned on REST access to consumer secrets (temporarily).");
    }
    const credentials = await org.readCredentials(app.id);
    if (!credentials) throw new Error("The org did not return the app's consumer key and secret.");
    if (!(await fin.openNewToken())) throw new Error("Fin's Add token form did not render.");
    await fin.fill("name", input.tokenName);
    await fin.fill(
      "description",
      `Client credentials for External Client App ${input.appName}${app.runAs ? ` (runs as its API-only user)` : ""}.`,
    );
    await fin.chooseOAuth();
    await fin.fill("url", `https://${org.host}/services/oauth2/token`);
    await fin.chooseFormEncoded();
    await fin.fill("clientId", credentials.key);
    await fin.fill("clientSecret", credentials.secret);
    test = await fin.testRequest();
    if (!test.ok) throw new Error(`Fin's Test request did not pass: ${test.message}`);
    steps.push(`✅ Fin Test request: ${test.message}`);
    await fin.save();
    // Fin lands on the new token's own page after saving, so the page alone
    // proves nothing; the token list is the evidence.
    saved = (await fin.listTokenNames()).includes(input.tokenName);
    if (!saved) throw new Error(`"${input.tokenName}" is not in Fin's token list after Save.`);
    steps.push(`✅ Saved Fin auth token "${input.tokenName}" (verified in Fin's token list).`);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await fin.leave().catch(() => undefined);
  }

  let settingRestored = !turnedOn;
  if (turnedOn) {
    const off = await org.setRestSecretSetting(false);
    // Verify by what the org does now, not by the deploy's own report.
    const stillOn = (await org.restSecretSetting().catch(() => undefined)) !== false;
    const stillReadable = (await org.readCredentials(app.id).catch(() => undefined)) !== undefined;
    settingRestored = off.ok && !stillOn && !stillReadable;
    steps.push(
      settingRestored
        ? "✅ Turned REST access to consumer secrets off again; the API no longer returns the secret."
        : "⚠️ Could not verify REST access to consumer secrets is off. Turn it off in Setup → External Client Apps → Settings.",
    );
  }

  const ok = saved && !failure && settingRestored;
  return {
    ok,
    text: [
      ok
        ? `✅ Fin auth token "${input.tokenName}" created from ${input.appName}.`
        : `❌ token_transfer did not finish: ${failure ?? "the setting was not restored"}.`,
      ...steps.map((s) => `  ${s}`),
      ok
        ? `Next: bind it with sdk operation='auth_tokens' (find its id), set auth_token_id in the connector JSON, and upload.`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    details: {
      phase: "execute",
      ...base,
      saved,
      settingRestored,
      settingWasOn: wasOn,
      ...(failure ? { error: failure } : {}),
    },
  };
}

function refused(code: string, text: string, base: Record<string, unknown>): TokenTransferResult {
  return { ok: false, text: `❌ ${text}`, details: { phase: "refused", code, ...base } };
}
