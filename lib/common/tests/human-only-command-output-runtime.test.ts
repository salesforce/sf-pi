/* SPDX-License-Identifier: Apache-2.0 */
/** Real Pi 0.81 mode proofs for display-only command reports. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const PI_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "pi");
const tempDirs: string[] = [];

function runPi(extensionPath: string, modeArgs: string[], command: string, input?: string) {
  const agentDir = mkdtempSync(path.join(tmpdir(), "sf-pi-human-output-"));
  tempDirs.push(agentDir);
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  delete env.SF_LLM_GATEWAY_BASE_URL;
  delete env.SF_LLM_GATEWAY_API_KEY;
  delete env.SF_LLM_GATEWAY_INTERNAL_BASE_URL;
  delete env.SF_LLM_GATEWAY_INTERNAL_API_KEY;

  const args = [
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-session",
    "-e",
    path.join(REPO_ROOT, extensionPath),
    ...modeArgs,
  ];
  if (command) args.push(command);

  return spawnSync(PI_BIN, args, {
    cwd: agentDir,
    env,
    encoding: "utf8",
    timeout: 30_000,
    input,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("human-only command output through real Pi modes", () => {
  it("emits SF Feedback JSON output as an entry, never a custom message", () => {
    const result = runPi(
      "extensions/sf-feedback/index.ts",
      ["--mode", "json", "--print"],
      "/sf-feedback help",
    );

    expect(result.status, result.stderr).toBe(0);
    const events = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const entry = events.find((event) => event.type === "entry_appended") as
      { entry?: { type?: string; customType?: string; data?: { body?: string } } } | undefined;

    expect(entry?.entry).toMatchObject({ type: "custom", customType: "sf-feedback" });
    expect(entry?.entry?.data?.body).toContain("/sf-feedback subcommands");
    expect(events.some((event) => event.type === "message_start")).toBe(false);
  });

  it.each([
    [
      "SF Feedback",
      "extensions/sf-feedback/index.ts",
      "/sf-feedback help",
      "/sf-feedback subcommands",
    ],
    [
      "Gateway",
      "extensions/sf-llm-gateway-internal/index.ts",
      "/sf-llm-gateway help",
      "/sf-llm-gateway with no args",
    ],
  ])(
    "emits %s reports through the RPC notification channel",
    (_label, extensionPath, command, marker) => {
      const request = `${JSON.stringify({ id: "report", type: "prompt", message: command })}\n`;
      const result = runPi(extensionPath, ["--mode", "rpc"], "", request);

      expect(result.status, result.stderr).toBe(0);
      const events = result.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const notification = events.find(
        (event) => event.type === "extension_ui_request" && event.method === "notify",
      ) as { message?: string } | undefined;

      expect(notification?.message).toContain(marker);
      expect(events.some((event) => event.type === "message_start")).toBe(false);
    },
  );

  it.each([
    [
      "SF Feedback",
      "extensions/sf-feedback/index.ts",
      "/sf-feedback help",
      "/sf-feedback subcommands",
    ],
    [
      "Gateway",
      "extensions/sf-llm-gateway-internal/index.ts",
      "/sf-llm-gateway help",
      "/sf-llm-gateway with no args",
    ],
  ])("prints %s reports in print mode", (_label, extensionPath, command, marker) => {
    const result = runPi(extensionPath, ["--print"], command);

    expect(result.status, result.stderr).toBe(0);
    // Pi preserves print-mode stdout for the assistant response and routes
    // extension console output to stderr; both remain human-visible.
    expect(`${result.stdout}\n${result.stderr}`).toContain(marker);
  });

  it("emits Gateway JSON output as an entry, never a custom message", () => {
    const result = runPi(
      "extensions/sf-llm-gateway-internal/index.ts",
      ["--mode", "json", "--print"],
      "/sf-llm-gateway help",
    );

    expect(result.status, result.stderr).toBe(0);
    const events = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const entry = events.find((event) => event.type === "entry_appended") as
      { entry?: { type?: string; customType?: string; data?: { body?: string } } } | undefined;

    expect(entry?.entry).toMatchObject({
      type: "custom",
      customType: "sf-llm-gateway-internal",
    });
    expect(entry?.entry?.data?.body).toContain("/sf-llm-gateway with no args");
    expect(events.some((event) => event.type === "message_start")).toBe(false);
  });
});
