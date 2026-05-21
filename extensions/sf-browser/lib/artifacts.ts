/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Browser Evidence artifact storage.
 *
 * Full-resolution screenshots live on disk and only bounded image content is
 * returned to the model when requested. Evidence is scoped by pi session so a
 * user can audit screenshots produced during one conversation without mixing
 * unrelated browser work. The legacy `latest` location is a pointer to the
 * current session, not a duplicate screenshot store.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { SetupAuditTrailSummary } from "./setup-audit-trail.ts";
import { sanitizeLabel } from "./redaction.ts";

export type EvidenceImageMode = "artifact" | "thumbnail" | "full";

export interface BrowserEvidenceCapture {
  id: number;
  label: string;
  path: string;
  thumbnailPath?: string;
  createdAt: string;
  imageMode: EvidenceImageMode;
  includedImage: boolean;
  url?: string;
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  setupAuditTrail?: SetupAuditTrailSummary;
}

interface BrowserEvidenceIndexState {
  nextId: number;
  captures: BrowserEvidenceCapture[];
}

interface BrowserEvidenceLatestPointerState {
  sessionId?: string;
  dir?: string;
  indexPath?: string;
  updatedAt?: string;
}

export interface PlannedEvidenceCapture {
  id: number;
  label: string;
  path: string;
  thumbnailPath: string;
  dir: string;
}

const EVIDENCE_SCHEMA_VERSION = 1;
const LATEST_POINTER_SCHEMA_VERSION = 1;
const MAX_INDEX_CAPTURES = 500;
const MAX_EMBED_BYTES = 1_500_000;
const FALLBACK_SESSION_ID = "unknown-session";

const latestPointerStore = createStateStore<BrowserEvidenceLatestPointerState>({
  namespace: "browser-artifacts/latest",
  filename: "pointer.json",
  schemaVersion: LATEST_POINTER_SCHEMA_VERSION,
  defaults: {},
});

function safeSessionId(sessionId: string | undefined): string {
  return sanitizeLabel(sessionId, FALLBACK_SESSION_ID);
}

function evidenceStore(sessionId: string | undefined) {
  return createStateStore<BrowserEvidenceIndexState>({
    namespace: `browser-artifacts/sessions/${safeSessionId(sessionId)}`,
    filename: "index.json",
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    defaults: { nextId: 1, captures: [] },
  });
}

export function getEvidenceDir(sessionId?: string): string {
  return path.dirname(evidenceStore(sessionId).path);
}

export function getEvidenceIndexPath(sessionId?: string): string {
  return evidenceStore(sessionId).path;
}

export function getLatestEvidencePointerPath(): string {
  return latestPointerStore.path;
}

export function getLatestEvidencePointer(): BrowserEvidenceLatestPointerState {
  return latestPointerStore.read();
}

export function updateLatestEvidencePointer(sessionId: string | undefined): void {
  const safeId = safeSessionId(sessionId);
  latestPointerStore.write({
    sessionId: safeId,
    dir: getEvidenceDir(safeId),
    indexPath: getEvidenceIndexPath(safeId),
    updatedAt: new Date().toISOString(),
  });
}

export function planEvidenceCapture(
  label: string | undefined,
  sessionId?: string,
): PlannedEvidenceCapture {
  const store = evidenceStore(sessionId);
  const state = store.read();
  const id = Math.max(1, state.nextId || 1);
  const safeLabel = sanitizeLabel(label, "evidence");
  const prefix = `${String(id).padStart(6, "0")}-${safeLabel}`;
  const dir = path.dirname(store.path);
  mkdirSync(dir, { recursive: true });
  return {
    id,
    label: safeLabel,
    path: path.join(dir, `${prefix}.png`),
    thumbnailPath: path.join(dir, `${prefix}.thumb.jpg`),
    dir,
  };
}

export function commitEvidenceCapture(
  capture: BrowserEvidenceCapture,
  sessionId?: string,
): BrowserEvidenceCapture {
  evidenceStore(sessionId).update((current) => {
    const withoutDuplicate = current.captures.filter((item) => item.id !== capture.id);
    const captures = [...withoutDuplicate, capture].slice(-MAX_INDEX_CAPTURES);
    return { nextId: Math.max(current.nextId || 1, capture.id + 1), captures };
  });
  updateLatestEvidencePointer(sessionId);
  return capture;
}

export function latestEvidenceCaptures(limit = 5, sessionId?: string): BrowserEvidenceCapture[] {
  return evidenceStore(sessionId).read().captures.slice(-limit).reverse();
}

export function imageContentFromFile(filePath: string, mimeType: string): ImageContent | null {
  if (!existsSync(filePath)) return null;
  try {
    const size = statSync(filePath).size;
    if (size > MAX_EMBED_BYTES) return null;
    return {
      type: "image",
      data: readFileSync(filePath).toString("base64"),
      mimeType,
    };
  } catch {
    return null;
  }
}

export function evidenceModeFromUnknown(value: unknown): EvidenceImageMode {
  return value === "artifact" || value === "full" || value === "thumbnail" ? value : "thumbnail";
}
