/* SPDX-License-Identifier: Apache-2.0 */
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildChildEnv,
  classifyCliResult,
  isCliVersionSupported,
  parseCliVersion,
  readCliErrorMessage,
  redactSecret,
  runFinCli,
} from "../lib/cli-runner.ts";
import type { FinCredential } from "../lib/auth.ts";

const SENTINEL = "fin-sentinel-token-0000";
const credential: FinCredential = { token: SENTINEL, source: "pi-auth", region: "us" };
let dir: string;
let fakeCli: string;

/**
 * Fake `intercom` binary: echoes argv and the env values it received. `exit N`
 * exits with code N; `leak` writes the token to stderr. Lets tests prove where
 * the token went.
 */
const FAKE_CLI = `#!/usr/bin/env node
const out = {
  argv: process.argv.slice(2),
  env: {
    INTERCOM_TOKEN: process.env.INTERCOM_TOKEN,
    INTERCOM_REGION: process.env.INTERCOM_REGION,
    INTERCOM_CONFIG_DIR: process.env.INTERCOM_CONFIG_DIR,
    PARENT_SECRET: process.env.PARENT_SECRET,
    hasPath: Boolean(process.env.PATH),
  },
};
if (process.argv[2] === "leak") {
  process.stderr.write("echo " + process.env.INTERCOM_TOKEN + "\\n");
}
process.stdout.write(JSON.stringify(out));
process.exit(process.argv[2] === "exit" ? Number(process.argv[3]) : 0);
`;

/** Write a Node script as a spawnable fake CLI: a shebang file on POSIX, a .cmd wrapper on Windows. */
function writeFakeBinary(file: string, source: string): string {
  if (process.platform !== "win32") {
    writeFileSync(file, source, "utf8");
    chmodSync(file, 0o755);
    return file;
  }
  writeFileSync(`${file}.js`, source, "utf8");
  writeFileSync(`${file}.cmd`, `@ECHO off\r\n"%_prog%"  "%dp0%\\${path.basename(file)}.js" %*\r\n`);
  return `${file}.cmd`;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-cli-"));
  fakeCli = writeFakeBinary(path.join(dir, "intercom"), FAKE_CLI);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runFinCli credential boundary", () => {
  it("passes the token only through the child environment, never argv", async () => {
    const configDir = path.join(dir, "cli-config");
    const result = await runFinCli(["me", "--json"], {
      credential,
      binary: fakeCli,
      configDir,
      parentEnv: { PATH: process.env.PATH, PARENT_SECRET: "should-not-inherit" },
    });

    expect(classifyCliResult(result)).toBe("ok");
    const seen = JSON.parse(result.stdout) as { argv: string[]; env: Record<string, unknown> };
    expect(seen.argv).toEqual(["me", "--json"]);
    expect(seen.argv.join(" ")).not.toContain(SENTINEL);
    // The child received the token (we see it redacted on the way back out).
    expect(seen.env.INTERCOM_TOKEN).toBe("[redacted]");
    expect(seen.env.INTERCOM_REGION).toBe("us");
    expect(seen.env.INTERCOM_CONFIG_DIR).toBe(configDir);
    expect(seen.env.PARENT_SECRET).toBeUndefined();
    expect(seen.env.hasPath).toBe(true);
    expect(result.stdout).not.toContain(SENTINEL);
  });

  it("creates an owner-only private CLI config directory and leaves it empty", async () => {
    const configDir = path.join(dir, "cli-config");
    await runFinCli(["me"], {
      credential,
      binary: fakeCli,
      configDir,
      parentEnv: { PATH: process.env.PATH },
    });
    // Windows has no POSIX mode bits; access follows the profile's inherited ACLs.
    if (process.platform !== "win32") expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(readdirSync(configDir)).toEqual([]);
  });

  it("scrubs the token from stderr", async () => {
    const result = await runFinCli(["leak"], {
      credential,
      binary: fakeCli,
      configDir: path.join(dir, "c"),
      parentEnv: { PATH: process.env.PATH },
    });
    expect(result.stderr).toContain("echo [redacted]");
    expect(result.stderr).not.toContain(SENTINEL);
  });

  it("maps real CLI exit codes to stable outcome classes", async () => {
    const cases: Array<[string, string]> = [
      ["2", "auth_expired"],
      ["3", "rate_limited"],
      ["5", "permission_denied"],
      ["9", "cli_error"],
    ];
    for (const [code, outcome] of cases) {
      const result = await runFinCli(["exit", code], {
        binary: fakeCli,
        configDir: path.join(dir, "c"),
        parentEnv: { PATH: process.env.PATH },
      });
      expect(result.exitCode).toBe(Number(code));
      expect(classifyCliResult(result)).toBe(outcome);
    }
  });

  it("enforces the timeout", async () => {
    const slow = writeFakeBinary(
      path.join(dir, "slow"),
      "#!/usr/bin/env node\nsetTimeout(() => {}, 10000);\n",
    );
    const result = await runFinCli([], {
      binary: slow,
      configDir: path.join(dir, "c"),
      parentEnv: { PATH: process.env.PATH },
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(classifyCliResult(result)).toBe("timeout");
  });

  it("reports a missing binary as cli_missing", async () => {
    const result = await runFinCli(["--version"], {
      binary: path.join(dir, "does-not-exist"),
      configDir: path.join(dir, "c"),
    });
    expect(classifyCliResult(result)).toBe("cli_missing");
  });
});

describe("cli-runner helpers", () => {
  it("builds an allowlisted environment", () => {
    const env = buildChildEnv(credential, "/tmp/x", {
      PATH: "/bin",
      HOME: "/home/u",
      OPENAI_API_KEY: "nope",
      INTERCOM_APP_ID: "abc123",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/u",
      INTERCOM_CONFIG_DIR: "/tmp/x",
      NO_COLOR: "1",
      INTERCOM_TOKEN: SENTINEL,
      INTERCOM_REGION: "us",
      INTERCOM_APP_ID: "abc123",
    });
    expect(buildChildEnv(undefined, "/tmp/x", { PATH: "/bin" })).toEqual({
      PATH: "/bin",
      INTERCOM_CONFIG_DIR: "/tmp/x",
      NO_COLOR: "1",
    });
  });

  it("classifies exit codes", () => {
    const base = { stdout: "", stderr: "", timedOut: false, truncated: false };
    expect(classifyCliResult({ ...base, exitCode: 0 })).toBe("ok");
    expect(classifyCliResult({ ...base, exitCode: 2 })).toBe("auth_expired");
    expect(classifyCliResult({ ...base, exitCode: 3 })).toBe("rate_limited");
    expect(classifyCliResult({ ...base, exitCode: 4 })).toBe("not_found");
    expect(classifyCliResult({ ...base, exitCode: 5 })).toBe("permission_denied");
    expect(classifyCliResult({ ...base, exitCode: 6 })).toBe("timeout");
    expect(classifyCliResult({ ...base, exitCode: 1 })).toBe("cli_error");
    expect(classifyCliResult({ ...base, exitCode: null, timedOut: true })).toBe("timeout");
    expect(classifyCliResult({ ...base, exitCode: 0, truncated: true })).toBe("cli_error");
  });

  it("reads the CLI JSON error envelope", () => {
    const stderr = JSON.stringify({
      error: { code: "auth_error", message: "Authentication expired or invalid" },
    });
    expect(
      readCliErrorMessage({ exitCode: 2, stdout: "", stderr, timedOut: false, truncated: false }),
    ).toBe("Authentication expired or invalid");
  });

  it("parses and compares CLI versions", () => {
    expect(parseCliVersion("0.14.1\n")).toBe("0.14.1");
    expect(parseCliVersion("garbage")).toBeUndefined();
    expect(isCliVersionSupported("0.14.1")).toBe(true);
    expect(isCliVersionSupported("0.14.0")).toBe(true);
    expect(isCliVersionSupported("0.13.9")).toBe(false);
    expect(isCliVersionSupported("1.0.0")).toBe(true);
  });

  it("redacts every occurrence of the secret", () => {
    expect(redactSecret(`a ${SENTINEL} b ${SENTINEL}`, SENTINEL)).toBe("a [redacted] b [redacted]");
    expect(redactSecret("unchanged", undefined)).toBe("unchanged");
  });
});
