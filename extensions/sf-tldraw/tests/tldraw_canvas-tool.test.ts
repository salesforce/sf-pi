/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";
import { formatTldrawRuntimeStatus } from "../lib/runtime-surface.ts";
import {
  formatRenderSuccess,
  registerTldrawCanvasTool,
  renderSuccessContent,
} from "../lib/tldraw_canvas-tool.ts";

describe("tldraw_canvas family tool", () => {
  afterEach(() => vi.restoreAllMocks());

  function registeredTool() {
    const registerTool = vi.fn();
    registerTldrawCanvasTool({ registerTool } as unknown as ExtensionAPI);
    expect(registerTool).toHaveBeenCalledTimes(1);
    return registerTool.mock.calls[0]![0];
  }

  it("registers one family tool with grounding and readiness guidance", () => {
    const tool = registeredTool();
    expect(tool.name).toBe("tldraw_canvas");
    expect(tool.promptGuidelines.join("\n")).toMatch(/Never infer or fabricate Salesforce facts/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/action='cheatsheet'/);
    expect(tool.promptGuidelines.join("\n")).toMatch(/readiness/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/OS automation/i);
  });

  it("advertises render actions without embedding Spec v2 in the public schema", () => {
    const tool = registeredTool();
    const schema = JSON.stringify(tool.parameters);
    expect(schema).toContain('"create_document"');
    expect(schema).toContain('"cheatsheet"');
    expect(schema).toContain('"render_salesforce_data_model"');
    expect(schema).not.toContain('"execute"');
    expect(schema).not.toContain('"script_workspace"');
    expect(schema).not.toContain('"screenshot"');
    expect(schema).not.toContain('"spec_version"');
    expect(schema).not.toContain('"participants"');
    expect(schema).not.toContain('"interactions"');
    expect(schema).not.toContain('"objects"');
    expect(schema).toContain('"additionalProperties":false');
    expect(schema).toContain('"name"');
    expect(schema).toContain('"card_fill"');
    expect(schema).toContain('"transparent"');
    expect(schema).toContain('"legend_relationships"');
    expect(schema).toContain('"show"');
    expect(schema).toContain('"hide"');
    expect(schema).toContain('"spec"');
  });

  it("points invalid specs at the lazy cheatsheet", async () => {
    const tool = registeredTool();
    const result = await tool.execute(
      "id",
      { action: "render_salesforce_data_model", spec: { family: "data_model" } },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    expect(result.content[0].text).toMatch(/Salesforce Diagram Spec is invalid/);
    expect(result.content[0].text).toContain('action: "cheatsheet"');
    expect(result.details.sfTldraw).toMatchObject({
      ok: false,
      reason: "invalid_spec",
      recover_via: { action: "cheatsheet" },
    });
  });

  it("uses the shared runtime observation and formatter for status", async () => {
    const observation = {
      status: {
        kind: "ready" as const,
        openDocuments: 1,
        focusedDocumentName: "Support Model.tldraw",
        capabilities: {
          apiContract: "canvas-api-v1.12" as const,
          contractProof: "readme" as const,
          nativeDocumentCreation: true as const,
          documents: true as const,
          search: true as const,
          execute: true as const,
          screenshot: true as const,
        },
        skillReadiness: { kind: "ready" as const, managed: true, message: "ready" },
      },
      documents: [{ id: "doc-1", name: "Support Model.tldraw" }],
    };
    const observe = vi
      .spyOn(TldrawRuntimeClient.prototype, "observe")
      .mockResolvedValue(observation);
    const tool = registeredTool();
    const result = await tool.execute("id", { action: "status" }, undefined, undefined, {
      cwd: process.cwd(),
    });
    expect(observe).toHaveBeenCalledOnce();
    expect(result.content).toEqual([
      { type: "text", text: formatTldrawRuntimeStatus(observation.status) },
    ]);
  });

  it("creates a document without an extra acknowledgement and returns its id", async () => {
    vi.spyOn(TldrawRuntimeClient.prototype, "createDocument").mockResolvedValue({
      id: "doc-created",
      documentId: "document-created",
      name: "Support Model.tldraw",
      windowId: 3,
    });
    vi.spyOn(TldrawRuntimeClient.prototype, "skillReadiness").mockReturnValue({
      kind: "ready",
      managed: true,
      manifestVersion: "1.12.0",
      message: "ready",
    });
    const tool = registeredTool();
    const result = await tool.execute(
      "id",
      { action: "create_document", name: "Support Model" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    expect(result.content[0].text).toContain("Document id: doc-created");
    expect(result.details.sfTldraw).toMatchObject({
      ok: true,
      action: "create_document",
      document: { id: "doc-created", name: "Support Model.tldraw" },
    });
  });

  it("keeps summary, inline, and file-only render results distinct", () => {
    const outcome = {
      ok: true,
      spec: {
        grounding: {
          sources: [{ id: "schema", kind: "org_describe", label: "Object describe" }],
        },
      },
      result: {
        family: "data_model",
        documentId: "doc-1",
        pageName: "Support Model",
        createdShapes: 8,
        updatedShapes: 2,
        deletedShapes: 0,
        readiness: {
          lintCount: 0,
          markerChecks: [],
          warnings: ["One route warning"],
          bindingChecks: [{ id: "edge-1", valid: true }],
          sequenceGeometryChecks: [],
          typographyChecks: [{ id: "account", apiGap: 8, formatValid: true }],
          cardContentChecks: [{ id: "account", overflow: 0 }],
          routeChecks: [{ id: "edge-1", obstructedBy: ["case"] }],
          routeCrossingChecks: [],
          sharedCorridorChecks: [],
          markerOverlapChecks: [],
        },
      },
      artifact: {
        reportPath: "/tmp/report.json",
        screenshotPath: "/tmp/full.jpg",
        thumbnailPath: "/tmp/thumb.jpg",
      },
    };

    const summary = formatRenderSuccess({ ...outcome, outputMode: "summary" } as never);
    expect(summary).toContain("Shapes: 8 created");
    expect(summary).not.toContain("Inline readiness details");

    const inline = formatRenderSuccess({ ...outcome, outputMode: "inline" } as never);
    expect(inline).toContain("Inline readiness details");
    expect(inline).toContain("Route obstructions: 1");
    expect(inline).toContain("schema · org_describe · Object describe");

    const fileOnlyOutcome = { ...outcome, outputMode: "file_only" } as never;
    const fileOnly = formatRenderSuccess(fileOnlyOutcome);
    expect(fileOnly).toContain("Report: /tmp/report.json");
    expect(fileOnly).not.toContain("Shapes:");
    expect(fileOnly).not.toContain("Warnings:");
    expect(renderSuccessContent(fileOnlyOutcome)).toEqual([{ type: "text", text: fileOnly }]);

    const oversized = {
      ...outcome,
      outputMode: "inline",
      result: {
        ...outcome.result,
        readiness: {
          ...outcome.result.readiness,
          warnings: Array.from({ length: 8 }, (_, index) => `${index}-${"w".repeat(2_000)}`),
        },
      },
    } as never;
    const boundedInline = formatRenderSuccess(oversized);
    expect(boundedInline.length).toBeLessThanOrEqual(8_000);
    expect(boundedInline).toContain("…truncated");
  });

  it("loads the cheatsheet lazily without contacting the runtime", async () => {
    const tool = registeredTool();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await tool.execute("id", { action: "cheatsheet" }, undefined, undefined, {
      cwd: process.cwd(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("# `tldraw_canvas` cheatsheet");
    vi.unstubAllGlobals();
  });
});
