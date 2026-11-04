/* SPDX-License-Identifier: Apache-2.0 */
/** Guidance and data connector authoring: validate, paused/draft-only upload, state changes. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { writeFinSdkState } from "../../../lib/common/fin-sdk-state.ts";
import type { FinCredential } from "../lib/auth.ts";
import type { CliRunResult } from "../lib/cli-runner.ts";
import {
  createDataConnector,
  detectResourceKind,
  setGuidanceState,
  uploadResource,
  validateResourceFile,
} from "../lib/sdk-resources.ts";
import type { SdkReadDeps } from "../lib/sdk-reads.ts";

const GUIDANCE_SCHEMA = path.join(import.meta.dirname, "fixtures", "guidance-schema.json");
const DC_SCHEMA = path.join(import.meta.dirname, "fixtures", "data-connector-schema.json");
const credential: FinCredential = { token: "fin-sentinel-0000", source: "pi-auth", region: "us" };

const GUIDANCE = `type: guidance
id: new
title: Keep answers short
category: tone
prompt: Answer in two or three sentences.
`;
const CONNECTOR = {
  type: "data_connector",
  id: 77,
  name: "Example status lookup",
  description: "Looks up an example account status by email.",
  enable_direct_usage: false,
  inputs: { email: { format: "string", description: "Email address" } },
  request: { method: "GET", url: "https://api.example.com/status?email=<read attr='email' />" },
  mock_response: { body: { status: "active" } },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-res-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  writeFinSdkState({ state: "enabled", appId: "example" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, body: string) => {
  const p = path.join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
};
const cli = (stdout = "", exitCode = 0, stderr = ""): CliRunResult => ({
  exitCode,
  stdout,
  stderr,
  timedOut: false,
  truncated: false,
});
function deps(run: ReturnType<typeof vi.fn>): SdkReadDeps {
  return {
    run: run as unknown as SdkReadDeps["run"],
    exec: vi.fn(),
    fetch: vi.fn(async () => new Response("{}", { status: 200 })),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    appId: "example",
  };
}

describe("validateResourceFile", () => {
  it("detects the resource kind from the file type", () => {
    expect(detectResourceKind(file("g.yaml", GUIDANCE))).toBe("guidance");
    expect(detectResourceKind(file("c.json", JSON.stringify(CONNECTOR)))).toBe("data_connector");
    expect(detectResourceKind(file("p.yaml", "name: X\nprocedure: {}\n"))).toBe("procedure");
  });

  it("accepts paused or stateless guidance and rejects live guidance", () => {
    expect(validateResourceFile(file("g.yaml", GUIDANCE), "guidance", GUIDANCE_SCHEMA).ok).toBe(
      true,
    );
    const live = validateResourceFile(
      file("live.yaml", `${GUIDANCE}state: live\n`),
      "guidance",
      GUIDANCE_SCHEMA,
    );
    expect(live.ok).toBe(false);
    expect(live.issues.map((i) => i.path)).toContain("/state");
  });

  it("checks guidance against the workspace schema", () => {
    const bad = validateResourceFile(
      file("bad.yaml", GUIDANCE.replace("category: tone", "category: shouting")),
      "guidance",
      GUIDANCE_SCHEMA,
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.path === "/category")).toBe(true);
  });

  it("requires a draft data connector with an existing id, https, used inputs, and a mock", () => {
    const ok = validateResourceFile(
      file("c.json", JSON.stringify(CONNECTOR)),
      "data_connector",
      DC_SCHEMA,
    );
    expect(ok.ok).toBe(true);
    const bad = validateResourceFile(
      file(
        "bad.json",
        JSON.stringify({
          ...CONNECTOR,
          id: "new",
          state: "live",
          inputs: { ...CONNECTOR.inputs, unused: { format: "string" } },
          request: { method: "GET", url: "http://api.example.com/x" },
          mock_response: undefined,
        }),
      ),
      "data_connector",
      DC_SCHEMA,
    );
    const paths = bad.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(["/state", "/id", "/request/url", "/inputs/unused", "/mock_response"]),
    );
  });
});

describe("uploadResource", () => {
  it("uploads guidance with state forced to paused and verifies it", async () => {
    let sent = "";
    const run = vi.fn(async (args: string[]) => {
      sent = readFileSync(args[3]!, "utf8");
      return cli(
        JSON.stringify({ id: 9, new_file_content: "type: guidance\nid: 9\nstate: paused\n" }),
      );
    });
    const result = await uploadResource(credential, deps(run), {
      file: file("g.yaml", GUIDANCE),
      kind: "guidance",
      schemaPath: GUIDANCE_SCHEMA,
    });
    expect(result.ok).toBe(true);
    expect(parse(sent)).toMatchObject({ type: "guidance", state: "paused" });
    expect(result.text).toContain("guidance_state");
  });

  it("fails closed when Fin reports a state other than paused/draft", async () => {
    const run = vi.fn(async () =>
      cli(JSON.stringify({ id: 9, new_file_content: "type: guidance\nid: 9\nstate: live\n" })),
    );
    const result = await uploadResource(credential, deps(run), {
      file: file("g.yaml", GUIDANCE),
      kind: "guidance",
      schemaPath: GUIDANCE_SCHEMA,
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({ phase: "verify", state: "live" });
  });

  it("never uploads an invalid file", async () => {
    const run = vi.fn(async () => cli("{}"));
    const result = await uploadResource(credential, deps(run), {
      file: file("live.yaml", `${GUIDANCE}state: live\n`),
      kind: "guidance",
      schemaPath: GUIDANCE_SCHEMA,
    });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("uploads a data connector as a draft from the original file", async () => {
    const run = vi.fn(async (_args: string[]) =>
      cli(
        JSON.stringify({
          id: 77,
          new_file_content: JSON.stringify({
            ...CONNECTOR,
            state: "draft",
            request: {
              method: "GET",
              url: 'https://api.example.com/status?email=<read attr="input.email" />',
            },
          }),
        }),
      ),
    );
    const connector = file("c.json", JSON.stringify(CONNECTOR));
    const result = await uploadResource(credential, deps(run), {
      file: connector,
      kind: "data_connector",
      schemaPath: DC_SCHEMA,
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("publish the draft in the Intercom web UI");
    expect((run.mock.calls[0]?.[0] as string[]).slice(0, 3)).toEqual([
      "fin",
      "procedures",
      "upload",
    ]);
  });
});

describe("data connector save verification", () => {
  it("fails closed when Fin's saved draft does not match the file", async () => {
    const run = vi.fn(async (_args: string[]) =>
      cli(
        JSON.stringify({
          id: 77,
          new_file_content: JSON.stringify({
            id: 77,
            name: "Untitled",
            state: "draft",
            inputs: {},
            request: { method: "GET", url: "" },
          }),
        }),
      ),
    );
    const result = await uploadResource(credential, deps(run), {
      file: file("c.json", JSON.stringify(CONNECTOR)),
      kind: "data_connector",
      schemaPath: DC_SCHEMA,
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({ phase: "verify" });
    expect((result.details as { mismatch: string[] }).mismatch).toEqual(
      expect.arrayContaining(["name", "request.url", "inputs"]),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the upload response has no saved content", async () => {
    const run = vi.fn(async (_args: string[]) => cli(JSON.stringify({ id: 77, message: "ok" })));
    const result = await uploadResource(credential, deps(run), {
      file: file("c.json", JSON.stringify(CONNECTOR)),
      kind: "data_connector",
      schemaPath: DC_SCHEMA,
    });
    expect(result.ok).toBe(false);
  });
});

describe("createDataConnector", () => {
  it("creates a named draft and returns its id; rejects an empty name", async () => {
    const run = vi.fn(async (_args: string[]) => cli(JSON.stringify({ id: 77, name: "Lookup" })));
    const ok = await createDataConnector(credential, deps(run), { name: "Lookup" });
    expect(ok).toMatchObject({ ok: true, details: { id: "77" } });
    expect(run.mock.calls[0]?.[0]).toEqual([
      "fin",
      "data-connectors",
      "create",
      "--name",
      "Lookup",
      "--json",
    ]);
    const empty = vi.fn();
    expect((await createDataConnector(credential, deps(empty), { name: " " })).ok).toBe(false);
    expect(empty).not.toHaveBeenCalled();
  });
});

describe("setGuidanceState", () => {
  const current = (state: string) =>
    cli(
      JSON.stringify({
        format: "yaml",
        content: `type: guidance\nid: 9\ntitle: Keep answers short\nstate: ${state}\ncategory: tone\nprompt: Short.\n`,
      }),
    );
  function stateRun(from: string, saved = "live") {
    return vi.fn(async (args: string[]) => {
      if (args[1] === "guidance" && args[2] === "get") return current(from);
      if (args[2] === "upload")
        return cli(
          JSON.stringify({ id: 9, new_file_content: `type: guidance\nid: 9\nstate: ${saved}\n` }),
        );
      return cli("{}", 1);
    });
  }

  it("plans by default and changes nothing", async () => {
    const run = stateRun("paused");
    const plan = await setGuidanceState(credential, deps(run), {
      guidanceId: "9",
      target: "live",
      execute: false,
    });
    expect(plan.details).toMatchObject({ phase: "plan", from: "paused", to: "live" });
    expect(run.mock.calls.map((c) => (c[0] as string[])[2])).toEqual(["get"]);
  });

  it("executes by re-uploading with only state changed, then verifies", async () => {
    let sent: Record<string, unknown> = {};
    const base = stateRun("paused");
    const run = vi.fn(async (args: string[]) => {
      if (args[2] === "upload") sent = parse(readFileSync(args[3]!, "utf8"));
      return base(args);
    });
    const result = await setGuidanceState(credential, deps(run), {
      guidanceId: "9",
      target: "live",
      execute: true,
    });
    expect(result.ok).toBe(true);
    expect(sent).toMatchObject({ id: 9, state: "live", prompt: "Short.", category: "tone" });
  });

  it("fails closed on a state mismatch; no-ops when already in state; rejects bad ids", async () => {
    const mismatch = await setGuidanceState(credential, deps(stateRun("paused", "paused")), {
      guidanceId: "9",
      target: "live",
      execute: true,
    });
    expect(mismatch).toMatchObject({ ok: false, details: { phase: "verify" } });
    const noop = await setGuidanceState(credential, deps(stateRun("live")), {
      guidanceId: "9",
      target: "live",
      execute: true,
    });
    expect(noop).toMatchObject({ ok: true, details: { phase: "noop" } });
    const never = vi.fn();
    const bad = await setGuidanceState(credential, deps(never), {
      guidanceId: "9 && x",
      target: "live",
      execute: true,
    });
    expect(bad.ok).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});
