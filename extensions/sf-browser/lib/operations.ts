/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared command/tool operations for SF Browser.
 */
import { writeFileSync } from "node:fs";
import {
  formatDimensionNote,
  resizeImage,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { runAgentBrowser } from "./agent-browser.ts";
import {
  commitEvidenceCapture,
  type EvidenceImageMode,
  evidenceModeFromUnknown,
  imageContentFromFile,
  planEvidenceCapture,
  readImageContentFromFile,
} from "./artifacts.ts";
import { OPEN_NEXT_STEPS } from "./guidance.ts";
import { dismissAmbientOverlays } from "./overlay-dismissal.ts";
import { redactUrl } from "./redaction.ts";
import { fetchSetupAuditTrail, summarizeSetupAuditTrail } from "./setup-audit-trail.ts";
import { resolveOpenOrgUrl, summarizeOpenTarget, type OpenOrgInput } from "./salesforce-open.ts";
import { startTimer } from "./timing.ts";
import { okText } from "./tool-support.ts";

export async function openOrgInAgentBrowser(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: OpenOrgInput,
  signal?: AbortSignal,
): Promise<{ text: string; details: Record<string, unknown> }> {
  const stopTimer = startTimer();
  const open = await resolveOpenOrgUrl(pi, ctx, input, signal);
  await runAgentBrowser(pi, ["open", open.url], { cwd: ctx.cwd, signal });
  const duration = stopTimer();
  return {
    text: okText([
      summarizeOpenTarget(open.targetOrg, open.path),
      input.purpose ? `Purpose: ${input.purpose}` : undefined,
      `Duration: ${duration.durationText}`,
      "",
      OPEN_NEXT_STEPS,
    ]),
    details: {
      ok: true,
      targetOrg: open.targetOrg,
      path: open.path,
      setup: input.setup,
      purpose: input.purpose,
      session: "sf-pi",
      ...duration,
    },
  };
}

export async function captureEvidence(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: {
    label?: string;
    imageMode?: EvidenceImageMode | string;
    dismissOverlays?: boolean;
    scrollToRef?: string;
    target_org?: string;
    includeSetupAuditTrail?: boolean;
    auditLookbackMinutes?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    deviceScaleFactor?: number;
  },
  signal?: AbortSignal,
): Promise<{ content: Array<TextContent | ImageContent>; details: Record<string, unknown> }> {
  const stopTimer = startTimer();
  const sessionId = ctx.sessionManager.getSessionId();
  const mode = evidenceModeFromUnknown(input.imageMode);
  const planned = planEvidenceCapture(input.label, sessionId);
  const viewport = resolveEvidenceViewport(input, mode);
  if (viewport) await setViewport(pi, ctx.cwd, viewport, signal);

  const overlayDismissal =
    input.dismissOverlays === false
      ? { dismissedRefs: [], snapshotChecked: false }
      : await dismissAmbientOverlays(pi, ctx.cwd, signal);
  let scrolledToRef: string | undefined;
  if (input.scrollToRef) {
    await runAgentBrowser(pi, ["scrollintoview", input.scrollToRef], {
      cwd: ctx.cwd,
      signal,
      timeoutMs: 15_000,
    });
    scrolledToRef = input.scrollToRef;
  }

  await runAgentBrowser(pi, ["screenshot", planned.path], { cwd: ctx.cwd, signal });

  let image: ImageContent | null = null;
  let thumbnailPath: string | undefined;
  let dimensionNote: string | undefined;
  if (mode === "thumbnail") {
    const sourceImage = readImageContentFromFile(planned.path, "image/png");
    const resized = sourceImage
      ? await resizeImage(sourceImage, {
          maxWidth: viewport?.width ?? 1440,
          maxHeight: viewport?.height ?? 1000,
          maxBytes: 1_500_000,
          jpegQuality: 55,
        })
      : null;
    if (resized) {
      thumbnailPath = thumbnailPathForMime(planned.thumbnailPath, resized.mimeType);
      writeFileSync(thumbnailPath, Buffer.from(resized.data, "base64"));
      image = { type: "image", data: resized.data, mimeType: resized.mimeType };
      dimensionNote = formatDimensionNote(resized);
    }
  } else if (mode === "full") {
    image = imageContentFromFile(planned.path, "image/png");
  }

  const currentUrl = await getCurrentUrl(pi, ctx.cwd, signal);
  const setupAuditTrail = input.includeSetupAuditTrail
    ? await fetchSetupAuditTrail(
        pi,
        ctx,
        { target_org: input.target_org, auditLookbackMinutes: input.auditLookbackMinutes },
        signal,
      )
    : undefined;
  const duration = stopTimer();
  const capture = commitEvidenceCapture(
    {
      id: planned.id,
      label: planned.label,
      path: planned.path,
      thumbnailPath,
      createdAt: new Date().toISOString(),
      imageMode: mode,
      includedImage: image !== null,
      url: currentUrl,
      viewport,
      setupAuditTrail,
    },
    sessionId,
  );

  const text = okText([
    `Captured Browser Evidence #${capture.id}.`,
    `Label: ${capture.label}`,
    `Mode: ${capture.imageMode}`,
    `Image included: ${capture.includedImage ? "yes" : "no"}`,
    `Duration: ${duration.durationText}`,
    `Session: ${sessionId}`,
    `Path: ${capture.path}`,
    capture.thumbnailPath ? `Thumbnail: ${capture.thumbnailPath}` : undefined,
    viewport ? `Viewport: ${viewport.width}x${viewport.height}` : undefined,
    dimensionNote,
    capture.url ? `URL: ${capture.url}` : undefined,
    scrolledToRef ? `Scrolled into view: ${scrolledToRef}` : undefined,
    overlayDismissal.dismissedRefs.length
      ? `Dismissed ambient overlays: ${overlayDismissal.dismissedRefs.join(", ")}`
      : undefined,
    ...(setupAuditTrail ? summarizeSetupAuditTrail(setupAuditTrail) : []),
    mode === "artifact"
      ? "Artifact mode is best for repeated or batch captures."
      : "Use artifact mode for repeated captures; thumbnail mode is for current-screen model inspection.",
  ]);
  const content: Array<TextContent | ImageContent> = [{ type: "text", text }];
  if (image) content.push(image);
  return {
    content,
    details: { ok: true, sessionId, capture, overlayDismissal, scrolledToRef, ...duration },
  };
}

function thumbnailPathForMime(plannedPath: string, mimeType: string): string {
  if (mimeType === "image/png") return plannedPath.replace(/\.jpg$/i, ".png");
  if (mimeType === "image/jpeg") return plannedPath.replace(/\.png$/i, ".jpg");
  return plannedPath;
}

function resolveEvidenceViewport(
  input: { viewportWidth?: number; viewportHeight?: number; deviceScaleFactor?: number },
  mode: EvidenceImageMode,
): { width: number; height: number; deviceScaleFactor?: number } | undefined {
  const hasExplicitViewport =
    input.viewportWidth !== undefined || input.viewportHeight !== undefined;
  if (!hasExplicitViewport && mode !== "thumbnail") return undefined;
  const width = clampViewport(input.viewportWidth, 1440);
  const height = clampViewport(input.viewportHeight, 1000);
  const scale = input.deviceScaleFactor;
  return {
    width,
    height,
    ...(Number.isFinite(scale) && scale && scale > 0
      ? { deviceScaleFactor: Math.min(3, scale) }
      : {}),
  };
}

function clampViewport(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(3000, Math.max(320, Math.floor(value as number)));
}

async function setViewport(
  pi: ExtensionAPI,
  cwd: string,
  viewport: { width: number; height: number; deviceScaleFactor?: number },
  signal: AbortSignal | undefined,
): Promise<void> {
  await runAgentBrowser(
    pi,
    [
      "set",
      "viewport",
      String(viewport.width),
      String(viewport.height),
      ...(viewport.deviceScaleFactor ? [String(viewport.deviceScaleFactor)] : []),
    ],
    { cwd, signal, timeoutMs: 15_000 },
  );
}

async function getCurrentUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], { cwd, signal, timeoutMs: 15_000 });
    return redactUrl(result.stdout.trim());
  } catch {
    return undefined;
  }
}
