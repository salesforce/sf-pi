/* SPDX-License-Identifier: Apache-2.0 */
/** Opt-in full-corpus regression over normalized, externally supplied Gallery specs. */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileProfile } from "../lib/profiles.ts";
import { renderSalesforceDiagram } from "../lib/renderer.ts";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";
import { DEFAULT_TLDRAW_PREFERENCES } from "../lib/settings.ts";
import { validateDiagramSpec } from "../lib/spec-validation.ts";
import type { DataModelSpec, RenderArtifact, RenderReadiness } from "../lib/types.ts";

const manifestPath = process.env.SF_TLDRAW_DATA_MODEL_GALLERY_MANIFEST;
const liveEnabled = Boolean(manifestPath);
const liveIt = liveEnabled ? it : it.skip;
const sharedPageName = process.env.SF_TLDRAW_DATA_MODEL_GALLERY_PAGE?.trim();
const expectedCount = optionalPositiveInteger(
  process.env.SF_TLDRAW_DATA_MODEL_GALLERY_EXPECTED_COUNT,
);
const expectedHash = process.env.SF_TLDRAW_DATA_MODEL_GALLERY_EXPECTED_HASH?.trim();
const legendRelationships = optionalLegendRelationships(
  process.env.SF_TLDRAW_DATA_MODEL_GALLERY_LEGEND_RELATIONSHIPS,
);
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_KEY = /^\d{3}-[a-z0-9][a-z0-9-]{0,79}$/;
const warningBudgetBaseline = loadWarningBudgetBaseline(
  path.join(import.meta.dirname, "fixtures", "data-model-gallery-warning-budgets.json"),
);

interface ExternalManifestItem {
  index?: number;
  slug: string;
  category: string;
  title: string;
  file: string;
}

interface GalleryWarningBudget {
  key: string;
  maxRouteObstructions: number;
  maxRouteCrossings: number;
  maxSharedCorridors: number;
}

interface GalleryWarningBudgetBaseline {
  schemaVersion: 1;
  corpusHash: string;
  expectedCount: number;
  cases: GalleryWarningBudget[];
}

interface GalleryCase extends ExternalManifestItem {
  key: string;
  spec: DataModelSpec;
}

interface GalleryRow {
  key: string;
  slug: string;
  category: string;
  title: string;
  pageName: string;
  objectCount: number;
  relationshipCount: number;
  status: "pending" | "passed" | "invalid" | "render-failed" | "blocked";
  durationMs?: number;
  message?: string;
  readiness?: RenderReadiness;
  warningBudget?: GalleryWarningBudget;
  artifact?: RenderArtifact;
  thumbnail?: string;
}

const cases = manifestPath ? loadCases(manifestPath) : [];
const corpusHash = sha256(JSON.stringify(cases.map((item) => item.spec)));
const warningBudgetByKey = new Map(
  warningBudgetBaseline.cases.map((budget) => [budget.key, budget]),
);
const usesPinnedWarningBudgets = corpusHash === warningBudgetBaseline.corpusHash;
const rows: GalleryRow[] = cases.map((item) => ({
  key: item.key,
  slug: item.slug,
  category: item.category,
  title: item.title,
  pageName: sharedPageName || `Gallery Matrix — ${item.key}`.slice(0, 64),
  objectCount: item.spec.objects.length,
  relationshipCount: item.spec.relationships.length,
  status: "pending",
  warningBudget: usesPinnedWarningBudgets ? warningBudgetByKey.get(item.key) : undefined,
}));

let client: TldrawRuntimeClient | undefined;
let documentId: string | undefined;
let preflightError: Error | undefined;
let qualification: { status: "pending" | "passed" | "failed"; message?: string } = {
  status: liveEnabled ? "pending" : "passed",
};

describe("sf-tldraw Data Model Gallery matrix", { concurrent: false }, () => {
  beforeAll(async () => {
    if (!liveEnabled) return;
    client = new TldrawRuntimeClient({ timeoutMs: 120_000 });
    try {
      documentId = (await client.resolveDocument(undefined)).id;
    } catch (error) {
      preflightError = error instanceof Error ? error : new Error(String(error));
    }
  });

  it("keeps the checked-in Gallery warning baseline complete and unique", () => {
    expect(warningBudgetBaseline.cases).toHaveLength(warningBudgetBaseline.expectedCount);
    expect(new Set(warningBudgetBaseline.cases.map((budget) => budget.key)).size).toBe(
      warningBudgetBaseline.expectedCount,
    );
  });

  it("does not treat an omitted warning metric as zero", () => {
    expect(() => requiredMetricLength(undefined, "route crossings")).toThrow(
      /metric must be present/i,
    );
  });

  liveIt(
    "keeps every supplied Gallery spec valid and deterministic",
    () => {
      try {
        expect(cases.length).toBeGreaterThan(0);
        expect(new Set(cases.map((item) => item.key)).size).toBe(cases.length);
        if (expectedCount !== undefined) expect(cases.length).toBe(expectedCount);
        if (expectedHash) expect(corpusHash).toBe(expectedHash);
        if (usesPinnedWarningBudgets) {
          expect(cases).toHaveLength(warningBudgetBaseline.expectedCount);
          expect(cases.map((item) => item.key)).toEqual(
            warningBudgetBaseline.cases.map((budget) => budget.key),
          );
        }
        if (cases.length > 30)
          expect(sharedPageName, "large corpora must reuse one page").toBeTruthy();
        for (const item of cases) {
          const row = requiredRow(item.key);
          try {
            const validation = validateDiagramSpec(item.spec, "data_model");
            expect(validation.errors, item.key).toEqual([]);
            const options = {
              renderMode: "replace" as const,
              pageName: sharedPageName || `Gallery Matrix — ${item.key}`.slice(0, 64),
              preferences: {
                ...DEFAULT_TLDRAW_PREFERENCES,
                cardinalityDetail: "full" as const,
                ...(legendRelationships ? { legendRelationships } : {}),
              },
            };
            expect(compileProfile(item.spec, options), item.key).toEqual(
              compileProfile(structuredClone(item.spec), options),
            );
          } catch (error) {
            row.status = "invalid";
            row.message = error instanceof Error ? error.message : String(error);
            throw error;
          }
        }
        qualification = { status: "passed" };
      } catch (error) {
        qualification = {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
        throw error;
      }
    },
    Math.max(10_000, cases.length * 500),
  );

  for (const item of cases) {
    liveIt(
      `${item.category}: ${item.key}`,
      async () => {
        const row = requiredRow(item.key);
        if (preflightError || !client || !documentId) {
          row.status = "blocked";
          row.message = preflightError?.message ?? "tldraw runtime preflight did not complete.";
          throw new Error(`${item.key}: ${row.message}`);
        }
        const started = Date.now();
        const outcome = await renderSalesforceDiagram(
          {
            family: "data_model",
            spec: item.spec,
            documentId,
            pageName: row.pageName,
            mode: "replace",
            outputMode: "file_only",
            preferences: {
              cardinalityDetail: "full",
              cardFill: "transparent",
              ...(legendRelationships ? { legendRelationships } : {}),
            },
          },
          { cwd: process.cwd(), client },
        );
        row.durationMs = Date.now() - started;
        if (outcome.ok === false) {
          row.status = outcome.reason === "readiness_blocked" ? "blocked" : "render-failed";
          row.message = `${outcome.reason}: ${outcome.message}`;
          row.readiness = outcome.result?.readiness;
          throw new Error(`${item.key}: ${row.message}`);
        }
        row.readiness = outcome.result.readiness;
        row.artifact = outcome.artifact;
        try {
          expect(outcome.result.pageName, item.key).toBe(row.pageName);
          expect(outcome.result.readiness, item.key).toMatchObject({ ready: true, lintCount: 0 });
          expect(outcome.result.readiness.markerOverlapChecks, item.key).toEqual([]);
          const routeObstructions = requiredMetricLength(
            outcome.result.readiness.routeChecks,
            `${item.key} route obstructions`,
          );
          const routeCrossings = requiredMetricLength(
            outcome.result.readiness.routeCrossingChecks,
            `${item.key} route crossings`,
          );
          const sharedCorridors = requiredMetricLength(
            outcome.result.readiness.sharedCorridorChecks,
            `${item.key} shared corridors`,
          );
          expectWithinBudget(
            routeObstructions,
            row.warningBudget?.maxRouteObstructions,
            `${item.key} route obstructions`,
          );
          expectWithinBudget(
            routeCrossings,
            row.warningBudget?.maxRouteCrossings,
            `${item.key} route crossings`,
          );
          expectWithinBudget(
            sharedCorridors,
            row.warningBudget?.maxSharedCorridors,
            `${item.key} shared corridors`,
          );
          row.status = "passed";
        } catch (error) {
          row.status = "blocked";
          row.message = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
      120_000,
    );
  }

  afterAll(() => {
    if (!liveEnabled) return;
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = path.join(
      getAgentDir(),
      "sf-pi",
      "tldraw-artifacts",
      "data-model-gallery-matrix",
      runId,
    );
    const thumbnails = path.join(directory, "thumbnails");
    secureDirectory(directory);
    secureDirectory(thumbnails);
    rows.forEach((row, index) => {
      if (!row.artifact) return;
      const extension = path.extname(row.artifact.thumbnailPath).toLowerCase() || ".jpg";
      const filename = `${String(index + 1).padStart(3, "0")}-${row.key}${extension}`;
      const destination = path.resolve(thumbnails, filename);
      if (!destination.startsWith(`${path.resolve(thumbnails)}${path.sep}`)) {
        throw new Error(`Unsafe Gallery thumbnail path for '${row.key}'.`);
      }
      copyFileSync(row.artifact.thumbnailPath, destination);
      chmodSync(destination, 0o600);
      row.thumbnail = path.join("thumbnails", filename);
    });
    const indexPath = path.join(directory, "index.json");
    const reportPath = path.join(directory, "report.md");
    const totals = rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {});
    writePrivate(
      indexPath,
      `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), corpusHash, expectedCount, expectedHash, qualification, legendRelationships: legendRelationships ?? "show", warningBudgetBaseline: usesPinnedWarningBudgets ? { schemaVersion: warningBudgetBaseline.schemaVersion, corpusHash: warningBudgetBaseline.corpusHash, expectedCount: warningBudgetBaseline.expectedCount } : undefined, manifestPath, documentId, sharedPageName, totals, cases: rows }, null, 2)}\n`,
    );
    writePrivate(
      reportPath,
      [
        "# SF tldraw Data Model Gallery matrix",
        "",
        `- Corpus: \`${corpusHash}\``,
        `- Qualification: \`${JSON.stringify(qualification)}\``,
        `- Relationships legend: \`${legendRelationships ?? "show"}\``,
        `- Totals: \`${JSON.stringify(totals)}\``,
        "",
        "| # | Model | Objects | Relationships | Obstructions / max | Crossings / max | Shared / max | Status | Evidence |",
        "|---:|---|---:|---:|---:|---:|---:|---|---|",
        ...rows.map(
          (row, index) =>
            `| ${index + 1} | ${row.title} | ${row.objectCount} | ${row.relationshipCount} | ${formatMetric(row.readiness?.routeChecks?.length, row.warningBudget?.maxRouteObstructions)} | ${formatMetric(row.readiness?.routeCrossingChecks?.length, row.warningBudget?.maxRouteCrossings)} | ${formatMetric(row.readiness?.sharedCorridorChecks?.length, row.warningBudget?.maxSharedCorridors)} | ${row.status} | ${row.thumbnail ? `[thumbnail](${row.thumbnail})` : (row.message ?? "none")} |`,
        ),
        "",
      ].join("\n"),
    );
    console.info(`SF_TLDRAW_DATA_MODEL_GALLERY_INDEX=${indexPath}`);
    console.info(`SF_TLDRAW_DATA_MODEL_GALLERY_REPORT=${reportPath}`);
  });
});

function loadWarningBudgetBaseline(filePath: string): GalleryWarningBudgetBaseline {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.corpusHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.corpusHash) ||
    !Number.isInteger(parsed.expectedCount) ||
    Number(parsed.expectedCount) <= 0 ||
    !Array.isArray(parsed.cases) ||
    parsed.cases.length !== parsed.expectedCount
  ) {
    throw new Error("Invalid checked-in Gallery warning budget baseline.");
  }
  const keys = new Set<string>();
  const budgets = parsed.cases.map((value) => {
    if (!isRecord(value) || typeof value.key !== "string" || !SAFE_KEY.test(value.key)) {
      throw new Error("Invalid Gallery warning budget key.");
    }
    if (keys.has(value.key)) throw new Error(`Duplicate Gallery warning budget '${value.key}'.`);
    keys.add(value.key);
    for (const name of [
      "maxRouteObstructions",
      "maxRouteCrossings",
      "maxSharedCorridors",
    ] as const) {
      if (!Number.isInteger(value[name]) || Number(value[name]) < 0) {
        throw new Error(`Invalid ${name} for Gallery warning budget '${value.key}'.`);
      }
    }
    return {
      key: value.key,
      maxRouteObstructions: Number(value.maxRouteObstructions),
      maxRouteCrossings: Number(value.maxRouteCrossings),
      maxSharedCorridors: Number(value.maxSharedCorridors),
    };
  });
  return {
    schemaVersion: 1,
    corpusHash: parsed.corpusHash,
    expectedCount: Number(parsed.expectedCount),
    cases: budgets,
  };
}

function loadCases(filePath: string): GalleryCase[] {
  const resolvedManifest = realpathSync(filePath);
  const manifest = JSON.parse(readFileSync(resolvedManifest, "utf8")) as ExternalManifestItem[];
  const directory = path.dirname(resolvedManifest);
  return manifest.map((item, position) => {
    if (!SAFE_SLUG.test(item.slug)) throw new Error(`Unsafe Gallery slug '${item.slug}'.`);
    if (item.index !== undefined && (!Number.isInteger(item.index) || item.index <= 0)) {
      throw new Error(`Invalid Gallery index '${String(item.index)}'.`);
    }
    const key = `${String(item.index ?? position + 1).padStart(3, "0")}-${item.slug}`;
    const candidatePath = path.isAbsolute(item.file)
      ? item.file
      : path.resolve(directory, item.file);
    const specPath = realpathSync(candidatePath);
    if (!specPath.startsWith(`${directory}${path.sep}`)) {
      throw new Error(`Gallery spec '${item.file}' is outside the manifest directory.`);
    }
    return {
      ...item,
      key,
      spec: JSON.parse(readFileSync(specPath, "utf8")) as DataModelSpec,
    };
  });
}

function requiredRow(key: string): GalleryRow {
  const row = rows.find((item) => item.key === key);
  if (!row) throw new Error(`Missing Gallery matrix row '${key}'.`);
  return row;
}

function optionalLegendRelationships(value: string | undefined): "show" | "hide" | undefined {
  if (!value) return undefined;
  if (value === "show" || value === "hide") return value;
  throw new Error(`Expected show or hide, received '${value}'.`);
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received '${value}'.`);
  }
  return parsed;
}

function requiredMetricLength(value: unknown, label: string): number {
  expect(Array.isArray(value), `${label} metric must be present`).toBe(true);
  return (value as unknown[]).length;
}

function expectWithinBudget(actual: number, budget: number | undefined, label: string): void {
  if (budget !== undefined) expect(actual, label).toBeLessThanOrEqual(budget);
}

function formatMetric(actual: number | undefined, maximum: number | undefined): string {
  if (actual === undefined) return "-";
  return maximum === undefined ? String(actual) : `${actual} / ${maximum}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
