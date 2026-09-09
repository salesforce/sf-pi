/* SPDX-License-Identifier: Apache-2.0 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileProfile } from "../lib/profiles.ts";
import { renderSalesforceDiagram } from "../lib/renderer.ts";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";
import { DEFAULT_TLDRAW_PREFERENCES } from "../lib/settings.ts";
import { validateDiagramSpec } from "../lib/spec-validation.ts";
import type { RenderArtifact, RenderReadiness } from "../lib/types.ts";
import { SEQUENCE_MATRIX } from "./fixtures/sequence-matrix.ts";

const liveEnabled = process.env.SF_TLDRAW_SEQUENCE_MATRIX === "1";
const liveIt = liveEnabled ? it : it.skip;
const matrixHash = sha256(JSON.stringify(SEQUENCE_MATRIX));
const compiledHash = sha256(
  JSON.stringify(
    SEQUENCE_MATRIX.map((item) =>
      compileProfile(item.spec, {
        renderMode: "replace",
        pageName: matrixPageName(item.slug),
        preferences: DEFAULT_TLDRAW_PREFERENCES,
      }),
    ),
  ),
);

type MatrixStatus = "pending" | "passed" | "invalid" | "render-failed" | "blocked";

interface MatrixRow {
  slug: string;
  category: string;
  pageName: string;
  participantCount: number;
  interactionCount: number;
  status: MatrixStatus;
  reason?: string;
  message?: string;
  readiness?: RenderReadiness;
  artifact?: RenderArtifact;
  thumbnail?: string;
}

const rows: MatrixRow[] = SEQUENCE_MATRIX.map((item) => ({
  slug: item.slug,
  category: item.category,
  pageName: matrixPageName(item.slug),
  participantCount: item.spec.participants.length,
  interactionCount: item.spec.interactions.length,
  status: "pending",
}));

let client: TldrawRuntimeClient | undefined;
let documentId: string | undefined;
let preflight: Record<string, unknown> = { status: liveEnabled ? "pending" : "disabled" };
let preflightError: Error | undefined;

describe("sf-tldraw sequence hardening matrix", { concurrent: false }, () => {
  beforeAll(async () => {
    if (!liveEnabled) return;
    client = new TldrawRuntimeClient();
    try {
      const capabilities = await client.capabilities();
      const documents = await client.documents();
      const document = await client.resolveDocument(undefined);
      documentId = document.id;
      preflight = {
        status: "ready",
        execute: capabilities.execute,
        screenshot: capabilities.screenshot,
        openDocuments: documents.length,
        documentName: document.name ?? "Untitled",
      };
    } catch (error) {
      preflightError = error instanceof Error ? error : new Error(String(error));
      preflight = { status: "blocked", message: preflightError.message };
    }
  });

  it("keeps the committed matrix broad, valid, and deterministic", () => {
    expect(SEQUENCE_MATRIX.length).toBeGreaterThanOrEqual(24);
    const categories = SEQUENCE_MATRIX.reduce<Record<string, number>>((counts, item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
      return counts;
    }, {});
    expect(categories.oauth).toBeGreaterThanOrEqual(8);
    expect(categories.sso).toBeGreaterThanOrEqual(6);
    expect(categories.integration).toBeGreaterThanOrEqual(10);
    expect(new Set(SEQUENCE_MATRIX.map((item) => item.slug)).size).toBe(SEQUENCE_MATRIX.length);

    const kinds = new Set<string>();
    let hasReverse = false;
    let hasNonAdjacent = false;
    let hasActivation = false;
    let hasEightLanes = false;
    for (const item of SEQUENCE_MATRIX) {
      const row = requiredRow(item.slug);
      const validation = validateDiagramSpec(item.spec, "sequence");
      if (validation.errors.length > 0) {
        row.status = "invalid";
        row.reason = "invalid_spec";
        row.message = validation.errors.map((error) => error.message).join("; ");
      }
      expect(validation.errors, item.slug).toEqual([]);
      const first = compileProfile(item.spec, {
        renderMode: "replace",
        pageName: matrixPageName(item.slug),
        preferences: DEFAULT_TLDRAW_PREFERENCES,
      });
      const second = compileProfile(item.spec, {
        renderMode: "replace",
        pageName: matrixPageName(item.slug),
        preferences: DEFAULT_TLDRAW_PREFERENCES,
      });
      expect(second, item.slug).toEqual(first);
      expect(first.nodes.length, item.slug).toBe(item.spec.participants.length);
      expect(first.sequenceInteractions?.length, item.slug).toBe(item.spec.interactions.length);
      item.spec.interactions.forEach((interaction) => kinds.add(interaction.kind));
      const lane = new Map(
        item.spec.participants.map((participant, index) => [participant.id, index]),
      );
      hasReverse ||= item.spec.interactions.some(
        (interaction) => requiredLane(lane, interaction.from) > requiredLane(lane, interaction.to),
      );
      hasNonAdjacent ||= item.spec.interactions.some(
        (interaction) =>
          Math.abs(requiredLane(lane, interaction.from) - requiredLane(lane, interaction.to)) > 1,
      );
      hasActivation ||= (item.spec.activations?.length ?? 0) > 0;
      hasEightLanes ||= item.spec.participants.length === 8;
    }
    expect([...kinds].sort()).toEqual(["async", "event", "request", "response"]);
    expect({ hasReverse, hasNonAdjacent, hasActivation, hasEightLanes }).toEqual({
      hasReverse: true,
      hasNonAdjacent: true,
      hasActivation: true,
      hasEightLanes: true,
    });
  });

  for (const item of SEQUENCE_MATRIX) {
    liveIt(
      `${item.category}: ${item.slug}`,
      async () => {
        const row = requiredRow(item.slug);
        if (preflightError || !client || !documentId) {
          row.status = "blocked";
          row.reason = "runtime_preflight";
          row.message = preflightError?.message ?? "tldraw runtime preflight did not complete.";
          throw new Error(`${item.slug}: ${row.message}`);
        }
        const outcome = await renderSalesforceDiagram(
          {
            family: "sequence",
            spec: item.spec,
            documentId,
            pageName: row.pageName,
            mode: "replace",
            outputMode: "file_only",
          },
          { cwd: process.cwd(), client },
        );
        if (outcome.ok === false) {
          row.status = outcome.reason === "readiness_blocked" ? "blocked" : "render-failed";
          row.reason = outcome.reason;
          row.message = outcome.message;
          row.readiness = outcome.result?.readiness;
          throw new Error(
            `${item.slug}: ${outcome.reason}: ${outcome.message}\n${JSON.stringify(outcome.result?.readiness ?? outcome.validation ?? {}, null, 2)}`,
          );
        }
        row.status = "passed";
        row.readiness = outcome.result.readiness;
        row.artifact = outcome.artifact;
        expect(outcome.result.readiness, item.slug).toMatchObject({ ready: true, lintCount: 0 });
        expect(
          outcome.result.readiness.bindingChecks.every((check) => check.valid),
          item.slug,
        ).toBe(true);
        expect(
          outcome.result.readiness.sequenceGeometryChecks.every((check) => check.delta <= 1),
          item.slug,
        ).toBe(true);
        expect(outcome.artifact.screenshotPath, item.slug).toBeTruthy();
        expect(outcome.artifact.thumbnailPath, item.slug).toBeTruthy();
      },
      60_000,
    );
  }

  afterAll(() => {
    if (!liveEnabled) return;
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = path.join(
      getAgentDir(),
      "sf-pi",
      "tldraw-artifacts",
      "sequence-matrix",
      runId,
    );
    const thumbnailsDir = path.join(directory, "thumbnails");
    secureDirectory(directory);
    secureDirectory(thumbnailsDir);

    rows.forEach((row, index) => {
      if (!row.artifact) return;
      const extension = path.extname(row.artifact.thumbnailPath).toLowerCase();
      const filename = `${String(index + 1).padStart(2, "0")}-${row.slug}${extension}`;
      const destination = path.join(thumbnailsDir, filename);
      copyFileSync(row.artifact.thumbnailPath, destination);
      chmodSync(destination, 0o600);
      row.thumbnail = path.join("thumbnails", filename);
    });

    const totals = rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {});
    const manifestPath = path.join(directory, "index.json");
    const htmlPath = path.join(directory, "report.html");
    const markdownPath = path.join(directory, "report.md");
    writePrivate(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          matrixHash,
          compiledHash,
          caseCount: rows.length,
          categories: categoryCounts(),
          totals,
          preflight,
          cases: rows,
        },
        null,
        2,
      )}\n`,
    );
    writePrivate(htmlPath, renderHtml(rows, totals, matrixHash, compiledHash));
    writePrivate(markdownPath, renderMarkdown(rows, totals, matrixHash, compiledHash));
    console.info(`SF_TLDRAW_SEQUENCE_MATRIX_INDEX=${manifestPath}`);
    console.info(`SF_TLDRAW_SEQUENCE_MATRIX_REPORT=${htmlPath}`);
  });
});

function matrixPageName(slug: string): string {
  return `Sequence Matrix — ${slug}`;
}

function requiredRow(slug: string): MatrixRow {
  const row = rows.find((item) => item.slug === slug);
  if (!row) throw new Error(`Missing matrix row for '${slug}'.`);
  return row;
}

function requiredLane(lanes: Map<string, number>, id: string): number {
  const lane = lanes.get(id);
  if (lane === undefined) throw new Error(`Missing lane for '${id}'.`);
  return lane;
}

function categoryCounts(): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.category] = (counts[row.category] ?? 0) + 1;
    return counts;
  }, {});
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function writePrivate(filePath: string, content: string): void {
  writeFileSync(filePath, content, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function renderHtml(
  matrixRows: MatrixRow[],
  totals: Record<string, number>,
  inputHash: string,
  payloadHash: string,
): string {
  const cards = matrixRows
    .map((row) => {
      const image = row.thumbnail
        ? `<img src="${escapeHtml(row.thumbnail)}" alt="${escapeHtml(row.slug)} diagram">`
        : `<div class="missing">${escapeHtml(row.reason ?? "No screenshot")}</div>`;
      return `<figure class="${escapeHtml(row.status)}">${image}<figcaption><strong>${escapeHtml(row.slug)}</strong><span>${escapeHtml(row.category)} · ${row.participantCount} lanes · ${row.interactionCount} messages</span><span>${escapeHtml(row.status)}${row.message ? ` · ${escapeHtml(row.message)}` : ""}</span></figcaption></figure>`;
    })
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>SF tldraw sequence matrix</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#181818;background:#f7f8fa}body{margin:0;padding:28px}header{margin-bottom:24px}h1{margin:0 0 8px;font-size:28px}p{margin:4px 0;color:#5c6470}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}figure{margin:0;padding:12px;background:white;border:1px solid #d8dde6;border-radius:12px;box-shadow:0 2px 8px #0000000d}figure.passed{border-top:5px solid #2e844a}figure.blocked,figure.render-failed,figure.invalid{border-top:5px solid #ba0517}img{display:block;width:100%;height:320px;object-fit:contain;background:#f7f8fa}.missing{height:320px;display:grid;place-items:center;color:#ba0517;background:#fff1f1}figcaption{display:grid;gap:4px;margin-top:10px;font-size:13px}figcaption span{color:#5c6470;overflow-wrap:anywhere}code{font-size:12px}</style>
<header><h1>SF tldraw sequence hardening matrix</h1><p>${matrixRows.length} cases · ${escapeHtml(JSON.stringify(totals))}</p><p><code>matrix ${inputHash}</code></p><p><code>compiled ${payloadHash}</code></p></header>
<main class="grid">${cards}</main>`;
}

function renderMarkdown(
  matrixRows: MatrixRow[],
  totals: Record<string, number>,
  inputHash: string,
  payloadHash: string,
): string {
  const lines = [
    "# SF tldraw sequence hardening matrix",
    "",
    `- Cases: ${matrixRows.length}`,
    `- Totals: \`${JSON.stringify(totals)}\``,
    `- Matrix hash: \`${inputHash}\``,
    `- Compiled hash: \`${payloadHash}\``,
    "",
    "| Case | Category | Lanes | Messages | Status | Evidence |",
    "|---|---:|---:|---:|---|---|",
    ...matrixRows.map(
      (row) =>
        `| ${row.slug} | ${row.category} | ${row.participantCount} | ${row.interactionCount} | ${row.status} | ${row.thumbnail ? `[thumbnail](${row.thumbnail})` : (row.reason ?? "none")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}
