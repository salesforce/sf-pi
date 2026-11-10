/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const V112_README = [
  "`POST /api/search`",
  "`POST /api/docs/create`",
  "`POST /api/doc/:id/exec`",
  "api.getScreenshot",
  "helpers.createArrowBetweenShapes",
  "helpers.getLints",
].join("\n");

describe("TldrawRuntimeClient", () => {
  let dir: string;
  let captureDir: string;
  let configPath: string;
  let screenshotPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-runtime-"));
    configPath = path.join(dir, "server.json");
    writeFileSync(configPath, JSON.stringify({ port: 7236, token: "unit-test-token", pid: 123 }));
    const captureRoot = path.join(tmpdir(), "tldraw-agent-api");
    mkdirSync(captureRoot, { recursive: true });
    captureDir = mkdtempSync(path.join(captureRoot, "sf-tldraw-runtime-"));
    screenshotPath = path.join(captureDir, "screenshot.jpg");
    writeFileSync(screenshotPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(captureDir, { recursive: true, force: true });
  });

  it("requires and reports the installed v1.12 route contract", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({ success: true, result: [{ id: "doc-1", name: "Board", focusOrder: 0 }] });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    const status = await client.status();
    expect(status).toMatchObject({
      kind: "ready",
      openDocuments: 1,
      capabilities: {
        apiContract: "canvas-api-v1.12",
        contractProof: "readme",
        nativeDocumentCreation: true,
      },
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:7236/readme",
      "http://127.0.0.1:7236/api/search",
    ]);
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe(
      "Bearer unit-test-token",
    );
  });

  it("reports older or incomplete runtimes as incompatible", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("# old Canvas API\n`POST /api/search`"),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.status()).resolves.toMatchObject({
      kind: "incompatible",
      message: expect.stringMatching(/v1\.12 contract/i),
    });
  });

  it("gates direct public runtime actions on the v1.12 proof", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("# old Canvas API\n`POST /api/search`"),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.documents()).rejects.toMatchObject({ code: "unsupported" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a missing /readme route as incompatible", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "Not found" }, 404),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.status()).resolves.toMatchObject({
      kind: "incompatible",
      message: expect.stringMatching(/v1\.12 contract/i),
    });
  });

  it("classifies contract authentication failures without exposing the token", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "Authorization: Bearer unit-test-token" }, 401),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.status()).resolves.toMatchObject({
      kind: "auth-error",
      message: expect.not.stringContaining("unit-test-token"),
    });
  });

  it("bounds contract-proof requests with the client timeout", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({
      fetchImpl,
      serverConfigPath: configPath,
      timeoutMs: 5,
    });
    await expect(client.capabilities()).rejects.toMatchObject({ code: "timeout" });
  });

  it("uses /api/search for documents and validated screenshots", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      bodies.push(String(init.body));
      if (String(init.body).includes("getScreenshot")) {
        return json({
          success: true,
          result: {
            filePath: screenshotPath,
            width: 1200,
            height: 712.5,
            pageName: "Page",
            captureMode: "canvas",
          },
        });
      }
      return json({ success: true, result: [{ id: "doc-1", name: "Board", focusOrder: 0 }] });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    expect(await client.documents()).toHaveLength(1);
    expect(await client.screenshot("doc-1", { size: "full" })).toMatchObject({
      height: 712.5,
      captureMode: "canvas",
    });
    expect(bodies.some((body) => body.includes("api.getDocs"))).toBe(true);
    expect(bodies.find((body) => body.includes("api.getDocs"))).not.toContain("filePath");
    expect(bodies.some((body) => body.includes("api.getScreenshot"))).toBe(true);
  });

  it("rejects screenshot metadata with non-positive dimensions", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({
        success: true,
        result: {
          filePath: screenshotPath,
          width: 0,
          height: 712,
          pageName: "Page",
          captureMode: "canvas",
        },
      });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.screenshot("doc-1")).rejects.toMatchObject({
      code: "invalid_response",
      message: expect.stringMatching(/incomplete screenshot metadata/i),
    });
  });

  it("rejects screenshot paths outside the dedicated capture directory", async () => {
    const outside = path.join(dir, "outside.jpg");
    writeFileSync(outside, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({
        success: true,
        result: {
          filePath: outside,
          width: 100,
          height: 100,
          pageName: "Page",
          captureMode: "canvas",
        },
      });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.screenshot("doc-1")).rejects.toMatchObject({
      code: "invalid_response",
      message: expect.stringMatching(/failed local file validation/i),
    });
  });

  it("still accepts screenshots from the legacy tldraw-canvas-api capture folder", async () => {
    const legacyRoot = path.join(tmpdir(), "tldraw-canvas-api");
    mkdirSync(legacyRoot, { recursive: true });
    const legacyDir = mkdtempSync(path.join(legacyRoot, "sf-tldraw-runtime-"));
    try {
      const legacyShot = path.join(legacyDir, "screenshot.jpg");
      writeFileSync(legacyShot, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { mode: 0o600 });
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.endsWith("/readme")) return new Response(V112_README);
        return json({
          success: true,
          result: {
            filePath: legacyShot,
            width: 100,
            height: 100,
            pageName: "Page",
            captureMode: "canvas",
          },
        });
      }) as unknown as typeof fetch;
      const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
      await expect(client.screenshot("doc-1")).resolves.toMatchObject({ format: "jpeg" });
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("rejects symbolic-link screenshot files even when their target is inside the capture directory", async () => {
    const link = path.join(captureDir, "screenshot-link.jpg");
    symlinkSync(screenshotPath, link);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({
        success: true,
        result: {
          filePath: link,
          width: 100,
          height: 100,
          pageName: "Page",
          captureMode: "canvas",
        },
      });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.screenshot("doc-1")).rejects.toMatchObject({
      code: "invalid_response",
      message: expect.stringMatching(/failed local file validation/i),
    });
  });

  it("redacts bearer material from runtime errors", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({ success: false, error: "Authorization: Bearer unit-test-token" }, 500);
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.execute("doc-1", "return true")).rejects.toMatchObject({
      code: "execution_failed",
      message: expect.not.stringContaining("unit-test-token"),
    });
  });

  it("creates a named document through the v1.12 route without exposing its file path", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({
        success: true,
        result: {
          id: "doc-2",
          documentId: "document-2",
          filePath: "/Users/example/Documents/Support Model.tldraw",
          name: "Support Model.tldraw",
          windowId: 2,
        },
      });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.createDocument("Support Model")).resolves.toEqual({
      id: "doc-2",
      documentId: "document-2",
      name: "Support Model.tldraw",
      windowId: 2,
    });
    expect(requests[1]!.url).toBe("http://127.0.0.1:7236/api/docs/create");
    expect(requests[1]!.init.body).toBe(JSON.stringify({ name: "Support Model" }));
    expect(new Headers(requests[1]!.init.headers).get("content-type")).toBe("application/json");
  });

  it("uses a longer bounded timeout for native document creation", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 15);
        init.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
      return json({
        success: true,
        result: {
          id: "doc-slow",
          documentId: "document-slow",
          filePath: "/Users/example/Documents/Slow.tldraw",
          name: "Slow.tldraw",
          windowId: 4,
        },
      });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({
      fetchImpl,
      serverConfigPath: configPath,
      timeoutMs: 5,
    });
    await expect(client.createDocument("Slow")).resolves.toMatchObject({ id: "doc-slow" });
  });

  it("uses the created document id directly in the next document-resolution step", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      if (url.endsWith("/api/docs/create")) {
        return json({
          success: true,
          result: {
            id: "doc-created",
            documentId: "document-created",
            filePath: "/Users/example/Documents/Support Model.tldraw",
            name: "Support Model.tldraw",
            windowId: 2,
          },
        });
      }
      return json({
        success: true,
        result: [{ id: "doc-created", name: "Support Model.tldraw", focusOrder: 0 }],
      });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    const created = await client.createDocument("Support Model");
    await expect(client.resolveDocument(created.id)).resolves.toMatchObject({
      id: "doc-created",
      name: "Support Model.tldraw",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects unsafe document names before calling the create route", async () => {
    const fetchImpl = vi.fn(async () => new Response(V112_README)) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.createDocument("../Support Model")).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a distinct conflict error when tldraw refuses to overwrite a document", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response(V112_README);
      return json({ error: "A document with that name already exists." }, 409);
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.createDocument("Support Model")).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
  });

  it("reports app-managed Pi skill readiness from the install manifest", () => {
    const agentDir = path.join(dir, "pi-agent");
    const skillPath = path.join(agentDir, "skills", "tldraw-offline", "SKILL.md");
    mkdirSync(path.dirname(skillPath), { recursive: true });
    writeFileSync(
      skillPath,
      "---\nname: tldraw-offline\ndescription: test\n---\n<!-- installed-by:tldraw-desktop-agent-skills -->\n",
    );
    writeFileSync(
      path.join(dir, "agent-skills.json"),
      JSON.stringify({ appVersion: "1.12.0", files: [skillPath], hooks: [] }),
    );
    const client = new TldrawRuntimeClient({ serverConfigPath: configPath, agentDir });
    expect(client.skillReadiness()).toEqual({
      kind: "ready",
      managed: true,
      manifestVersion: "1.12.0",
      message: expect.stringMatching(/ready/i),
    });
  });

  it.each([
    {
      label: "missing",
      skill: undefined,
      manifest: undefined,
      expected: "missing",
    },
    {
      label: "unmanaged",
      skill: "---\nname: tldraw-offline\ndescription: custom\n---\n",
      manifest: undefined,
      expected: "unmanaged",
    },
    {
      label: "stale version",
      skill: "<!-- installed-by:tldraw-desktop-agent-skills -->",
      manifest: { appVersion: "1.11.0", useCurrentSkillPath: true },
      expected: "stale",
    },
    {
      label: "relocated Pi directory",
      skill: "<!-- installed-by:tldraw-desktop-agent-skills -->",
      manifest: { appVersion: "1.12.0", useCurrentSkillPath: false },
      expected: "stale",
    },
  ])("reports $label skill wiring without modifying it", ({ skill, manifest, expected }) => {
    const agentDir = path.join(dir, "relocated-agent");
    const skillPath = path.join(agentDir, "skills", "tldraw-offline", "SKILL.md");
    if (skill !== undefined) {
      mkdirSync(path.dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, skill);
    }
    if (manifest) {
      writeFileSync(
        path.join(dir, "agent-skills.json"),
        JSON.stringify({
          appVersion: manifest.appVersion,
          files: [
            manifest.useCurrentSkillPath
              ? skillPath
              : path.join(dir, "default-agent", "skills", "tldraw-offline", "SKILL.md"),
          ],
        }),
      );
    }
    const before = skill === undefined ? undefined : readFileSync(skillPath);
    const client = new TldrawRuntimeClient({ serverConfigPath: configPath, agentDir });
    expect(client.skillReadiness()).toMatchObject({ kind: expected });
    if (before) expect(readFileSync(skillPath)).toEqual(before);
  });

  it("reports a missing server configuration as not running", async () => {
    const client = new TldrawRuntimeClient({ serverConfigPath: path.join(dir, "missing.json") });
    await expect(client.status()).resolves.toMatchObject({ kind: "not-running" });
  });
});
