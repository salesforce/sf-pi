/* SPDX-License-Identifier: Apache-2.0 */
/** Structured Lightning state derived from URL + accessibility snapshot text. */
import { SETUP_DESTINATIONS } from "./setup-destinations.ts";
import { redactUrl } from "./redaction.ts";

export type LightningSurface =
  | "record-page"
  | "object-list"
  | "object-new"
  | "setup-page"
  | "home"
  | "unknown";

export interface LightningState {
  surface: LightningSurface;
  objectApiName?: string;
  recordId?: string;
  mode?: "view" | "edit" | "new";
  setupDestination?: string;
  toastText?: string;
  hasModal: boolean;
  hasSpinner: boolean;
  hasValidation: boolean;
}

export function deriveLightningState(input: { url?: string; lines: string[] }): LightningState {
  const fromUrl = parseLightningUrl(input.url);
  const fromSnapshot = parseSnapshotState(input.lines);
  return { ...fromUrl, ...fromSnapshot };
}

export function formatLightningState(state: LightningState): string[] {
  const lines = [`Surface: ${state.surface}`];
  if (state.objectApiName) lines.push(`Object: ${state.objectApiName}`);
  if (state.recordId) lines.push(`Record Id: ${state.recordId}`);
  if (state.mode) lines.push(`Mode: ${state.mode}`);
  if (state.setupDestination) lines.push(`Setup destination: ${state.setupDestination}`);
  if (state.toastText) lines.push(`Toast: ${state.toastText}`);
  lines.push(`Modal: ${state.hasModal ? "present" : "none"}`);
  lines.push(`Spinner: ${state.hasSpinner ? "present" : "none"}`);
  lines.push(`Validation: ${state.hasValidation ? "present" : "none"}`);
  return lines;
}

function parseLightningUrl(
  url: string | undefined,
): Omit<LightningState, "hasModal" | "hasSpinner" | "hasValidation"> {
  if (!url) return { surface: "unknown" };
  const safeUrl = redactUrl(url) ?? url;
  const pathname = parsePathname(safeUrl);

  const record = pathname.match(
    /\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/([^/?#]+)/,
  );
  if (record) {
    const mode = record[3] === "edit" || record[3] === "view" ? record[3] : undefined;
    return {
      surface: "record-page",
      objectApiName: decodeURIComponent(record[1] ?? ""),
      recordId: record[2],
      ...(mode ? { mode } : {}),
    };
  }

  const idOnlyRecord = pathname.match(
    /\/lightning\/r\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/([^/?#]+)/,
  );
  if (idOnlyRecord) {
    const mode =
      idOnlyRecord[2] === "edit" || idOnlyRecord[2] === "view" ? idOnlyRecord[2] : undefined;
    return {
      surface: "record-page",
      recordId: idOnlyRecord[1],
      ...(mode ? { mode } : {}),
    };
  }

  const object = pathname.match(/\/lightning\/o\/([^/]+)\/([^/?#]+)/);
  if (object) {
    const objectApiName = decodeURIComponent(object[1] ?? "");
    const mode = object[2] === "new" ? "new" : undefined;
    return {
      surface: object[2] === "new" ? "object-new" : "object-list",
      objectApiName,
      ...(mode ? { mode } : {}),
    };
  }

  if (/\/lightning\/page\/home\/?$/i.test(pathname)) return { surface: "home" };

  if (/\/lightning\/action\/quick\//i.test(pathname)) return { surface: "unknown" };

  if (/\/lightning\/setup\//i.test(pathname)) {
    return { surface: "setup-page", setupDestination: setupDestinationFromPath(pathname) };
  }

  return { surface: "unknown" };
}

function parsePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function parseSnapshotState(
  lines: string[],
): Pick<LightningState, "toastText" | "hasModal" | "hasSpinner" | "hasValidation"> {
  const joined = lines.join("\n");
  return {
    toastText: findToastText(lines),
    hasModal: /^- dialog\b/im.test(joined) || /\bmodal\b/i.test(joined),
    hasSpinner: /\b(spinner|progressbar|loading\.\.\.)\b/i.test(joined),
    hasValidation:
      /^- alert\b/im.test(joined) ||
      /Please fix the following|Review the errors|Complete this field|required field|invalid value/i.test(
        joined,
      ),
  };
}

function findToastText(lines: string[]): string | undefined {
  const toastLine = lines.find((line) => /toast|was created|was saved|successfully/i.test(line));
  if (!toastLine) return undefined;
  return extractQuotedName(toastLine) || cleanLine(toastLine);
}

function setupDestinationFromPath(pathname: string): string | undefined {
  for (const [destination, path] of Object.entries(SETUP_DESTINATIONS)) {
    if (path === pathname) return destination;
  }
  return undefined;
}

function extractQuotedName(line: string): string {
  return line.match(/"([^"]*)"/)?.[1]?.trim() ?? "";
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}
