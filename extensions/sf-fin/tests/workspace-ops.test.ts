/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin-as-code depth: reference validation against the workspace's own
 * `.fin/` rosters, auth token metadata, connector state and logs, simulation
 * delete, and the one-agent status chain. No network: CLI calls are faked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFinSdkState } from "../../../lib/common/fin-sdk-state.ts";
import type { FinCredential } from "../lib/auth.ts";
import type { CliRunResult } from "../lib/cli-runner.ts";
import type { SdkReadDeps } from "../lib/sdk-reads.ts";
import {
  agentStatus,
  deleteSimulation,
  listAuthTokens,
  readConnectorLogs,
  referenceIssues,
  setConnectorState,
} from "../lib/sdk-workspace.ts";

const SENTINEL = "fin-sentinel-token-0000";
const credential: FinCredential = { token: SENTINEL, source: "pi-auth", region: "us" };
let dir: string;
let refDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-ws-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  writeFinSdkState({ state: "enabled", appId: "example" });
  refDir = path.join(dir, ".fin");
  mkdirSync(refDir, { recursive: true });
  writeFileSync(path.join(refDir, "actions.txt"), "Find order - Looks up one order by id\n");
  writeFileSync(path.join(refDir, "teams.json"), JSON.stringify([{ id: 1, name: "Billing" }]));
  writeFileSync(path.join(refDir, "admins.json"), JSON.stringify([{ id: 2, name: "Pat Example" }]));
  writeFileSync(
    path.join(refDir, "attributes.json"),
    JSON.stringify([{ name: "user.email", type: "string" }]),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

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
    fetch: vi.fn(async () => new Response(JSON.stringify({ procedures: [] }), { status: 200 })),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    appId: "example",
  };
}

describe("referenceIssues", () => {
  it("flags actions, escalation targets, and attributes the workspace does not have", () => {
    const procedure = {
      procedure: {
        main: [
          'Look it up with <use action="Find order" /> for <read attr="user.email" />.',
          'Then <use action="Refund order" />.',
          'Hand off with <escalate to="Billing" /> or <escalate to="Sales" />.',
          'Read <read attr="user.plan" /> and <read attr="temporary.x" />.',
          "<escalate />",
        ],
      },
    };
    const issues = referenceIssues(procedure, refDir);
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('"Refund order" is not a live data connector'),
      expect.stringContaining('"Sales" is not a team or teammate'),
    ]);
    // Attributes are filtered by Fin (temporary ones are procedure-local), so
    // absence is not an error.
    expect(issues.some((i) => i.message.includes("user.plan"))).toBe(false);
  });

  it("returns nothing when the workspace rosters are missing (not downloaded yet)", () => {
    expect(referenceIssues({ procedure: { main: ['<use action="X" />'] } }, "/nope")).toEqual([]);
  });
});

describe("listAuthTokens", () => {
  it("lists token metadata only and shows which connectors use each token", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "auth-tokens")
        return cli(
          JSON.stringify({
            data: [
              {
                id: "11",
                name: "Example OAuth",
                token_type: "oauth",
                token_prefix: "SHOULD_NOT_APPEAR",
                description: "x",
              },
            ],
          }),
        );
      if (args[0] === "data-connectors" && args[1] === "list")
        return cli(JSON.stringify({ data: [{ id: "77", name: "Lookup", state: "live" }] }));
      if (args[0] === "data-connectors" && args[1] === "get")
        return cli(JSON.stringify({ id: "77", name: "Lookup", state: "live", token_ids: ["11"] }));
      return cli("{}", 1);
    });
    const result = await listAuthTokens(credential, deps(run));
    expect(result.ok).toBe(true);
    expect(result.details.tokens).toEqual([
      { id: "11", name: "Example OAuth", type: "oauth", connectors: ["Lookup (77)"] },
    ]);
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_APPEAR");
  });
});

describe("listAuthTokens with an unreadable connector", () => {
  it("says a connector could not be read instead of claiming no connector uses the token", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "auth-tokens")
        return cli(
          JSON.stringify({ data: [{ id: "11", name: "Example OAuth", token_type: "oauth" }] }),
        );
      if (args[0] === "data-connectors" && args[1] === "list")
        return cli(JSON.stringify({ data: [{ id: "77", name: "Lookup", state: "live" }] }));
      if (args[0] === "data-connectors" && args[1] === "get") return cli("", 1);
      return cli("{}", 1);
    });
    const result = await listAuthTokens(credential, deps(run));
    expect(result.text).not.toContain("used by no connector");
    expect(result.text).toContain("could not read Lookup (77)");
    expect(result.details.unreadConnectors).toEqual(["Lookup (77)"]);
  });
});

describe("setConnectorState", () => {
  function stateRun(initial: string, after = initial, tokens: string[] = ["11"]) {
    let state = initial;
    return vi.fn(async (args: string[]) => {
      if (args[0] === "data-connectors" && args[1] === "get")
        return cli(
          JSON.stringify({
            id: "77",
            name: "Lookup",
            state,
            url: "https://api.example.com/x",
            token_ids: tokens,
          }),
        );
      if (args[0] === "data-connectors" && args[1] === "update") {
        state = after;
        return cli(JSON.stringify({ id: "77", state: after }));
      }
      return cli("{}", 1);
    });
  }

  it("plans by default and changes nothing", async () => {
    const run = stateRun("draft");
    const plan = await setConnectorState(credential, deps(run), {
      connectorId: "77",
      target: "live",
      execute: false,
    });
    expect(plan.details).toMatchObject({ phase: "plan", from: "draft", to: "live" });
    expect(plan.text).toContain("allow_mutation=true");
    expect(run.mock.calls.map((c) => (c[0] as string[]).slice(0, 2).join(" "))).toEqual([
      "data-connectors get",
    ]);
  });

  it("sets live through the public API, then verifies by reading it back", async () => {
    const run = stateRun("draft", "live");
    const result = await setConnectorState(credential, deps(run), {
      connectorId: "77",
      target: "live",
      execute: true,
    });
    expect(result).toMatchObject({ ok: true, details: { phase: "execute", observed: "live" } });
    const update = run.mock.calls.find((c) => (c[0] as string[])[1] === "update")?.[0];
    expect(update).toEqual(["data-connectors", "update", "77", "-f", "state=live", "--json"]);
  });

  it("explains that connector_state cannot publish unpublished changes on a live connector", async () => {
    const run = stateRun("live");
    const result = await setConnectorState(credential, deps(run), {
      connectorId: "77",
      target: "live",
      execute: true,
    });
    expect(result.details).toMatchObject({ phase: "noop" });
    expect(result.text).toContain("already live");
    expect(result.text).toContain("Set changes live");
    expect(result.text).toContain("data-connectors/77");
    expect(run.mock.calls.some((c) => (c[0] as string[])[1] === "update")).toBe(false);
  });

  it("refuses to set live a connector with no auth token unless it is a public API", async () => {
    const run = stateRun("draft", "live", []);
    const plan = await setConnectorState(credential, deps(run), {
      connectorId: "77",
      target: "live",
      execute: false,
    });
    expect(plan.text).toContain("no auth token");
  });

  it("refuses to set live a connector with no request URL (an incomplete draft)", async () => {
    const run = vi.fn(async (args: string[]) =>
      args[1] === "get"
        ? cli(
            JSON.stringify({ id: "77", name: "Untitled", state: "draft", url: "", token_ids: [] }),
          )
        : cli("{}"),
    );
    const plan = await setConnectorState(credential, deps(run), {
      connectorId: "77",
      target: "live",
      execute: true,
    });
    expect(plan).toMatchObject({ ok: false, details: { phase: "refused" } });
    expect(plan.text).toContain("no request URL");
    expect(run.mock.calls.some((c) => (c[0] as string[])[1] === "update")).toBe(false);
  });

  it("fails closed when the read-back disagrees, and rejects bad ids", async () => {
    const run = stateRun("draft", "draft");
    const result = await setConnectorState(credential, deps(run), {
      connectorId: "77",
      target: "live",
      execute: true,
    });
    expect(result).toMatchObject({ ok: false, details: { phase: "verify", observed: "draft" } });
    const none = vi.fn();
    expect(
      (
        await setConnectorState(credential, deps(none), {
          connectorId: "77; rm",
          target: "live",
          execute: true,
        })
      ).ok,
    ).toBe(false);
    expect(none).not.toHaveBeenCalled();
  });
});

describe("readConnectorLogs", () => {
  it("summarizes recent runs without bodies and keeps Fin's URL redaction", async () => {
    const run = vi.fn(async () =>
      cli(
        JSON.stringify({
          data: [
            {
              id: "1",
              success: true,
              http_status: 200,
              http_method: "get",
              request_url: "https://api.example.com/q [query params redacted]",
              execution_time_ms: 120,
              source_type: "fin",
              source_id: "4242",
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "2",
              success: false,
              http_status: 500,
              error_type: "http_error",
              http_method: "get",
              request_url: "https://api.example.com/q [query params redacted]",
              execution_time_ms: 80,
              source_type: "fin",
              source_id: "4242",
              created_at: "2026-01-01T00:01:00Z",
            },
          ],
        }),
      ),
    );
    const result = await readConnectorLogs(credential, deps(run), {
      connectorId: "77",
      sinceHours: 24,
    });
    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({ total: 2, failed: 1 });
    const args = (run.mock.calls[0] as unknown[])[0] as string[];
    expect(args.slice(0, 3)).toEqual(["data-connectors", "list-execution-results", "77"]);
    expect(args).not.toContain("--include-bodies");
    expect(result.text).toContain("500");
  });
});

describe("deleteSimulation", () => {
  it("plans with the test name, then deletes exactly one test and verifies it is gone", async () => {
    let tests = [
      { id: 9, name: "Duplicate" },
      { id: 10, name: "Keep" },
    ];
    const run = vi.fn(async (args: string[]) => {
      if (args[1] === "simulations" && args[2] === "list")
        return cli(
          `type: simulation_set\nprocedure_id: 4242\ntests:\n${tests.map((t) => `- id: ${t.id}\n  name: ${t.name}\n`).join("")}`,
        );
      if (args[1] === "simulations" && args[2] === "delete") {
        tests = tests.filter((t) => String(t.id) !== args[4]);
        return cli(JSON.stringify({ deleted: true }));
      }
      return cli("{}", 1);
    });
    const plan = await deleteSimulation(credential, deps(run), {
      procedureId: "4242",
      testId: "9",
      execute: false,
    });
    expect(plan.text).toContain('"Duplicate"');
    expect(run.mock.calls.some((c) => (c[0] as string[])[2] === "delete")).toBe(false);
    const done = await deleteSimulation(credential, deps(run), {
      procedureId: "4242",
      testId: "9",
      execute: true,
    });
    expect(done).toMatchObject({ ok: true, details: { phase: "execute", remaining: 1 } });
    const missing = await deleteSimulation(credential, deps(run), {
      procedureId: "4242",
      testId: "999",
      execute: true,
    });
    expect(missing).toMatchObject({ ok: false, details: { phase: "not_found" } });
  });
});

describe("agentStatus", () => {
  it("links a procedure to its connectors, their tokens, and the workflows that can run it", async () => {
    const procedure = `id: 4242\nversion: 3\nname: Order status\nstate: paused\nhas_unpublished_changes: true\ntargeting:\n  channels: [fin_agent_api]\nprocedure:\n  main:\n  - Look it up with <use action="Find order" /> then <escalate />\n`;
    const run = vi.fn(async (args: string[]) => {
      const key = args.slice(0, 3).join(" ");
      if (key === "fin procedures get") return cli(procedure);
      if (key === "fin simulations list")
        return cli("tests:\n- id: 1\n  name: A\n- id: 2\n  name: B\n");
      if (args[0] === "data-connectors" && args[1] === "list")
        return cli(JSON.stringify({ data: [{ id: "77", name: "Find order", state: "live" }] }));
      if (args[0] === "data-connectors" && args[1] === "get")
        return cli(
          JSON.stringify({ id: "77", name: "Find order", state: "live", token_ids: ["11"] }),
        );
      if (args[0] === "auth-tokens")
        return cli(
          JSON.stringify({ data: [{ id: "11", name: "Example OAuth", token_type: "oauth" }] }),
        );
      if (key === "fin workflows list")
        return cli(
          JSON.stringify([
            { id: "5", title: "Example cases", state: "live", trigger_type: "new_case" },
          ]),
        );
      return cli("{}", 1);
    });
    const result = await agentStatus(credential, deps(run), { procedureId: "4242" });
    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({
      procedure: { id: "4242", name: "Order status", state: "paused", unpublished: true },
      channels: ["fin_agent_api"],
      connectors: [{ id: "77", name: "Find order", state: "live", tokens: ["Example OAuth"] }],
      simulations: 2,
    });
    // fin_agent_api procedures are not run by channel workflows.
    expect(result.text).toContain("Fin Agent API");
    expect(result.text).toContain("Next");
    // With tests saved, the next step runs them without generating more
    // (generate defaults to true and would add duplicates of the saved tests).
    expect(result.details.next).toContain("generate=false");
  });

  it("reports an unreadable connector's token as unknown, not missing", async () => {
    const procedure = `id: 4242\nname: Order status\nstate: paused\nprocedure:\n  main:\n  - Look it up with <use action="Find order" />\n`;
    const run = vi.fn(async (args: string[]) => {
      const key = args.slice(0, 3).join(" ");
      if (key === "fin procedures get") return cli(procedure);
      if (key === "fin simulations list") return cli("tests: []\n");
      if (args[0] === "data-connectors" && args[1] === "list")
        return cli(JSON.stringify({ data: [{ id: "77", name: "Find order", state: "live" }] }));
      if (args[0] === "data-connectors" && args[1] === "get") return cli("", 1);
      if (args[0] === "auth-tokens") return cli(JSON.stringify({ data: [] }));
      if (key === "fin workflows list") return cli("[]");
      return cli("{}", 1);
    });
    const result = await agentStatus(credential, deps(run), { procedureId: "4242" });
    expect(result.text).not.toContain("no auth token");
    expect(result.text).toContain("token unknown (could not read the connector)");
  });
});
