/* SPDX-License-Identifier: Apache-2.0 */
/** SOAP-backed Anonymous Apex execution for low-latency probes with inline debug logs. */

import type { Connection } from "@salesforce/core";
import { apiVersion, requestText } from "./api.ts";

export interface SoapAnonymousResult {
  compiled: boolean;
  success: boolean;
  line?: number;
  column?: number;
  compileProblem?: string;
  exceptionMessage?: string;
  exceptionStackTrace?: string;
  logs: string;
}

const XML_CHAR_MAP: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
};

const XML_ENTITY_MAP: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

export async function executeAnonymousSoap(
  conn: Connection,
  apexCode: string,
): Promise<SoapAnonymousResult> {
  const accessToken = getAccessToken(conn);
  if (!accessToken) throw new Error("Anonymous Apex SOAP execution failed: no access token.");

  const orgId = getOrgId(conn, accessToken);
  if (!orgId) throw new Error("Anonymous Apex SOAP execution failed: org id unavailable.");

  const version = apiVersion(conn);
  const body = buildSoapBody(accessToken, apexCode);
  const response = await requestText(conn, "POST", `/services/Soap/s/${version}/${orgId}`, body, {
    "Content-Type": "text/xml; charset=UTF-8",
    Accept: "text/xml",
    SOAPAction: "executeAnonymous",
  });
  return parseSoapExecuteAnonymousResponse(response);
}

export function buildSoapBody(accessToken: string, apexCode: string): string {
  const escaped = escapeXml(apexCode);
  return `<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:cmd="http://soap.sforce.com/2006/08/apex"
xmlns:apex="http://soap.sforce.com/2006/08/apex">
  <env:Header>
    <cmd:SessionHeader>
      <cmd:sessionId>${escapeXml(accessToken)}</cmd:sessionId>
    </cmd:SessionHeader>
    <apex:DebuggingHeader><apex:debugLevel>DEBUGONLY</apex:debugLevel></apex:DebuggingHeader>
  </env:Header>
  <env:Body>
    <executeAnonymous xmlns="http://soap.sforce.com/2006/08/apex">
      <apexcode>${escaped}</apexcode>
    </executeAnonymous>
  </env:Body>
</env:Envelope>`;
}

export function parseSoapExecuteAnonymousResponse(xml: string): SoapAnonymousResult {
  const resultXml = extractTag(xml, "result");
  if (!resultXml) throw new Error("Invalid SOAP response: missing executeAnonymous result.");

  return {
    compiled: extractBoolean(resultXml, "compiled"),
    success: extractBoolean(resultXml, "success"),
    line: extractNumber(resultXml, "line"),
    column: extractNumber(resultXml, "column"),
    compileProblem: extractOptionalText(resultXml, "compileProblem"),
    exceptionMessage: extractOptionalText(resultXml, "exceptionMessage"),
    exceptionStackTrace: extractOptionalText(resultXml, "exceptionStackTrace"),
    logs: extractOptionalText(xml, "debugLog") ?? "",
  };
}

function getAccessToken(conn: Connection): string | undefined {
  return (
    (conn as unknown as { accessToken?: string }).accessToken ??
    (conn.getConnectionOptions?.() as { accessToken?: string } | undefined)?.accessToken
  );
}

function getOrgId(conn: Connection, accessToken: string): string | undefined {
  const tokenOrgId = accessToken.includes("!") ? accessToken.split("!")[0] : undefined;
  return tokenOrgId || (conn.getAuthInfoFields?.() as { orgId?: string } | undefined)?.orgId;
}

function extractBoolean(xml: string, name: string): boolean {
  return extractOptionalText(xml, name) === "true";
}

function extractNumber(xml: string, name: string): number | undefined {
  const value = extractOptionalText(xml, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractOptionalText(xml: string, name: string): string | undefined {
  const value = extractTag(xml, name);
  if (value === undefined) return undefined;
  const decoded = decodeXml(value).trim();
  return decoded.length ? decoded : undefined;
}

function extractTag(xml: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${escapeRegExp(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${escapeRegExp(name)}>`,
    "i",
  );
  const match = pattern.exec(xml);
  if (match) return match[1];
  const selfClosing = new RegExp(`<(?:[A-Za-z0-9_]+:)?${escapeRegExp(name)}(?:\\s[^>]*)?/>`, "i");
  return selfClosing.test(xml) ? "" : undefined;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => XML_CHAR_MAP[char] ?? char);
}

function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_entity, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return XML_ENTITY_MAP[body] ?? `&${body};`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
