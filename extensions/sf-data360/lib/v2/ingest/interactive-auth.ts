/* SPDX-License-Identifier: Apache-2.0 */

import { execFile } from "node:child_process";
import http from "node:http";
import os from "node:os";

import { exchangePkceForTenantIngestAuth, startTenantIngestPkce } from "./auth.ts";
import type { TenantIngestAuthStatus } from "./types.ts";

export interface InteractivePkceReadyEvent {
  authorizationUrl: string;
  callbackUrl: string;
  state: string;
}

export interface InteractivePkceOptions {
  /** Internal test seam; public action params must not control browser opening directly. */
  authorizationOpener?: (url: string) => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  onReady?: (event: InteractivePkceReadyEvent) => void | Promise<void>;
}

export interface InteractivePkceResult {
  ok: true;
  auth: TenantIngestAuthStatus;
  token: { tokenType?: string; expiresIn?: number };
  authSession: { id: string; tenantHost: string; expiresAt?: string };
  storesSecrets: false;
  secretStorage: "memory_only";
}

export async function runInteractivePkceAuth(
  params: Record<string, unknown>,
  options: InteractivePkceOptions = {},
): Promise<InteractivePkceResult> {
  const redirect = parseRedirectUri(requiredString(params, "redirectUri"));
  const server = http.createServer();
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      closeServer(server);
      reject(new Error("Timed out waiting for OAuth redirect."));
    }, timeoutMs);

    server.on("request", async (req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", actualBaseUrl(server, redirect));
        if (requestUrl.pathname !== redirect.pathname) {
          res.writeHead(404).end("Not found");
          return;
        }
        const error = requestUrl.searchParams.get("error");
        if (error) {
          throw new Error(`${error}: ${requestUrl.searchParams.get("error_description") ?? ""}`);
        }
        const code = requestUrl.searchParams.get("code") ?? "";
        const state = requestUrl.searchParams.get("state") ?? "";
        if (!code) throw new Error("Missing OAuth authorization code.");
        if (state !== started.authorization.state) throw new Error("OAuth state mismatch.");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Data 360 auth complete</h1><p>You can close this window.</p>");

        const exchanged = await exchangePkceForTenantIngestAuth(
          { strategy: "pkce", pkceState: state, authorizationCode: code },
          options.fetchFn ?? fetch,
        );
        clearTimeout(timeout);
        closeServer(server);
        resolve({ ok: true, ...exchanged, secretStorage: "memory_only" });
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Data 360 auth failed. Return to terminal.");
        }
        clearTimeout(timeout);
        closeServer(server);
        reject(error);
      }
    });

    server.listen(redirect.port, redirect.host, async () => {
      try {
        const callbackUrl = actualBaseUrl(server, redirect);
        started = startTenantIngestPkce({ ...params, redirectUri: callbackUrl });
        const authorizationUrl = validateSalesforceAuthorizationUrl(started.authorization.url);
        const ready = {
          authorizationUrl,
          callbackUrl,
          state: started.authorization.state,
        };
        await options.onReady?.(ready);
        (options.authorizationOpener ?? openAuthorizationUrl)(authorizationUrl);
      } catch (error) {
        clearTimeout(timeout);
        closeServer(server);
        reject(error);
      }
    });

    let started: ReturnType<typeof startTenantIngestPkce>;
  });
}

export function planInteractivePkceAuth(params: Record<string, unknown>): Record<string, unknown> {
  return {
    opensBrowser: true,
    listensOn: requiredString(params, "redirectUri"),
    storesSecrets: false,
    secretStorage: "memory_only",
    steps: [
      "Generate PKCE verifier/challenge and authorization URL.",
      "Open Salesforce authorization URL in the browser.",
      "Listen for the localhost OAuth redirect.",
      "Exchange authorization code through /services/oauth2/token and /services/a360/token.",
      "Return sanitized in-memory authSession metadata.",
    ],
  };
}

function parseRedirectUri(value: string): { host: string; port: number; pathname: string } {
  const url = new URL(value);
  if (url.protocol !== "http:")
    throw new Error("Only http:// localhost redirect URIs are supported.");
  const host = url.hostname || "127.0.0.1";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("Only localhost PKCE redirect URIs are supported.");
  }
  return { host, port: Number(url.port || "80"), pathname: url.pathname || "/" };
}

function actualBaseUrl(server: http.Server, redirect: { host: string; pathname: string }): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OAuth listener is not ready.");
  return `http://${redirect.host}:${address.port}${redirect.pathname}`;
}

function openAuthorizationUrl(url: string): void {
  if (os.platform() !== "darwin") return;
  execFile("open", [url], () => undefined);
}

export function validateSalesforceAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("OAuth authorization URL must use https.");
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "login.salesforce.com" ||
    host === "test.salesforce.com" ||
    host.endsWith(".my.salesforce.com") ||
    host.endsWith(".sandbox.my.salesforce.com");
  if (!allowed) throw new Error("OAuth authorization URL must target a Salesforce host.");
  return url.toString();
}

function closeServer(server: http.Server): void {
  server.close(() => undefined);
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required parameter '${key}'.`);
  }
  return value.trim();
}
