/* SPDX-License-Identifier: Apache-2.0 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

// Windows has no POSIX permission bits: Node reports 0o666 for writable files and
// ignores chmod modes, so owner-only modes can't be asserted there. Access is
// governed by inherited ACLs instead.
const POSIX_MODES = process.platform !== "win32";

describe("sf-tldraw artifacts", () => {
  let captureDir: string;
  let source: string;

  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-artifacts-"));
    const root = path.join(tmpdir(), "tldraw-canvas-api");
    mkdirSync(root, { recursive: true });
    captureDir = mkdtempSync(path.join(root, "sf-tldraw-artifacts-"));
    source = path.join(captureDir, "artifact.jpg");
    writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
    rmSync(captureDir, { recursive: true, force: true });
  });

  it("persists inspectable element-to-source provenance without target org", async () => {
    vi.resetModules();
    const { persistRenderArtifact } = await import("../lib/artifacts.ts");
    const spec = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
    );
    spec.purpose = "Review the public-safe support object structure.";
    spec.grounding = {
      mode: "org",
      as_of: "2026-07-27T12:00:00Z",
      display_label: "Authenticated sandbox",
      target_org: "private-alias",
      sources: [{ id: "schema", label: "Object describe", kind: "org_describe" }],
    };
    for (const object of spec.objects) object.evidence = ["schema"];
    for (const relationship of spec.relationships) relationship.evidence = ["schema"];
    const artifact = persistRenderArtifact({
      runId: "evidence-run",
      spec,
      result: {
        documentId: "doc-1",
        pageId: "page-1",
        pageName: "Page",
        family: "data_model",
        createdShapes: 1,
        updatedShapes: 0,
        deletedShapes: 0,
        readiness: {
          ready: true,
          blockers: [],
          warnings: [],
          lintCount: 0,
          markerChecks: [],
          bindingChecks: [],
          sequenceGeometryChecks: [],
          typographyChecks: [],
        },
      },
      screenshot: {
        filePath: source,
        width: 100,
        height: 80,
        pageName: "Page",
        captureMode: "canvas",
      },
      thumbnail: {
        filePath: source,
        width: 100,
        height: 80,
        pageName: "Page",
        captureMode: "canvas",
      },
    });
    if (POSIX_MODES) {
      expect(statSync(artifact.screenshotPath).mode & 0o777).toBe(0o600);
      expect(statSync(artifact.directory).mode & 0o777).toBe(0o700);
    }
    const reportDescriptor = openSync(
      artifact.reportPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    let report: string;
    try {
      if (POSIX_MODES) expect(fstatSync(reportDescriptor).mode & 0o777).toBe(0o600);
      report = readFileSync(reportDescriptor, "utf8");
    } finally {
      closeSync(reportDescriptor);
    }
    const envelope = JSON.parse(report);
    expect(envelope.schemaVersion).toBe(2);
    const parsed = envelope.state;
    expect(parsed).toMatchObject({
      title: "Reference support data model",
      scope: "Core support records with declared lookup relationships.",
      purpose: "Review the public-safe support object structure.",
      groundingMode: "org",
      groundingAsOf: "2026-07-27T12:00:00Z",
      groundingDisplayLabel: "Authenticated sandbox",
    });
    expect(parsed.evidence.sources).toEqual([
      { id: "schema", label: "Object describe", kind: "org_describe" },
    ]);
    expect(parsed.evidence.elements).toContainEqual({
      collection: "objects",
      id: "account",
      evidence: ["schema"],
    });
    expect(report).not.toContain("private-alias");
  });

  it("fails closed when a stale report target prevents a verified write", async () => {
    vi.resetModules();
    const { persistRenderArtifact } = await import("../lib/artifacts.ts");
    const reportTarget = path.join(
      tempAgentDir,
      "sf-pi",
      "tldraw-artifacts",
      "runs",
      "blocked-run",
      "report.json",
    );
    mkdirSync(reportTarget, { recursive: true });
    const spec = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
    );
    expect(() =>
      persistRenderArtifact({
        runId: "blocked-run",
        spec,
        result: {
          documentId: "doc-1",
          pageId: "page-1",
          pageName: "Page",
          family: "data_model",
          createdShapes: 1,
          updatedShapes: 0,
          deletedShapes: 0,
          readiness: {
            ready: true,
            blockers: [],
            warnings: [],
            lintCount: 0,
            markerChecks: [],
            bindingChecks: [],
            sequenceGeometryChecks: [],
            typographyChecks: [],
          },
        },
        screenshot: {
          filePath: source,
          width: 100,
          height: 80,
          pageName: "Page",
          captureMode: "canvas",
        },
        thumbnail: {
          filePath: source,
          width: 100,
          height: 80,
          pageName: "Page",
          captureMode: "canvas",
        },
      }),
    ).toThrow(/could not be persisted and verified/i);
  });
});
