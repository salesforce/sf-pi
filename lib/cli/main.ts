/* SPDX-License-Identifier: Apache-2.0 */
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  apexInputSchema,
  apexActions,
  apexDetailsSchemas,
  invokeApex,
  type ApexCallErrorCode,
} from "@sf-pi/apex";

const exitCodes: Record<ApexCallErrorCode, number> = {
  INPUT: 2,
  UNSUPPORTED: 3,
  AUTHORIZATION: 4,
  OPERATION: 5,
  TIMEOUT: 124,
  INTERRUPTED: 130,
};

const metadata = {
  name: "sf_apex",
  owner: "sf-apex",
  available: true,
  description:
    "Apex discovery, planning, source, trace/logs, anonymous execution, tests and coverage.",
  inputSchema: apexInputSchema,
  actionDetailsSchemas: apexDetailsSchemas,
  actions: apexActions,
  guidePath: fileURLToPath(import.meta.resolve("@sf-pi/apex/AGENT_GUIDE.md")),
};

class CliError extends Error {
  constructor(
    readonly code: number,
    readonly kind: string,
    message: string,
  ) {
    super(message);
  }
}

const HELP = `Apex-only Salesforce CLI (sf_apex).

sf-pi tools list [--json] [--available]
sf-pi tools describe <tool> [--json]
sf-pi call <tool> --input '<json>' [--workspace <path>]
sf-pi call <tool> --input-file <path> [--allow-effects]
sf-pi call <tool> --input - [--resume <run-file>]

Calls return one JSON object on stdout. Diagnostics go to stderr.
Options: --artifact-dir <path>, --timeout-ms <milliseconds> (default 120000).
--allow-effects authorizes trace changes, anonymous Apex or targeted tests for this call.
--resume loads state from a prior call with the same tool, workspace and target_org.
Exit codes: 0 success, 2 input, 3 unsupported, 4 authorization, 5 operation,
124 timeout, 130 interrupted.
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    let parsed: ReturnType<typeof parseArgs>;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: {
          json: { type: "boolean" },
          help: { type: "boolean", short: "h" },
          available: { type: "boolean" },
          "allow-effects": { type: "boolean" },
          input: { type: "string" },
          "input-file": { type: "string" },
          workspace: { type: "string" },
          "artifact-dir": { type: "string" },
          "timeout-ms": { type: "string" },
          resume: { type: "string" },
        },
      });
    } catch {
      throw new CliError(2, "INPUT", "Invalid command options. Run sf-pi --help.");
    }
    const { values, positionals } = parsed;
    const [command, action, name] = positionals;
    if (values.help || !command) {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === "tools" && action === "list" && positionals.length === 2) {
      const { name, owner, available, description } = metadata;
      if (values.json)
        output({ schemaVersion: 1, tools: [{ name, owner, available, description }] });
      else process.stdout.write(`${name}\tavailable\t${description}\n`);
      return 0;
    }
    if (command === "tools" && action === "describe" && positionals.length === 3) {
      if (name !== metadata.name)
        throw new CliError(3, "UNSUPPORTED", "Only sf_apex is available in this CLI.");
      output(metadata);
      return 0;
    }
    if (command !== "call" || positionals.length !== 2)
      throw new CliError(2, "INPUT", "Expected tools list, tools describe <tool>, or call <tool>.");
    if (action !== metadata.name)
      throw new CliError(3, "UNSUPPORTED", "Only sf_apex is available in this CLI.");
    const timeout = Number(values["timeout-ms"] ?? 120000);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600000)
      throw new CliError(2, "INPUT", "timeout-ms must be an integer from 1 to 3600000.");
    if (!!values.input === !!values["input-file"])
      throw new CliError(2, "INPUT", "Supply exactly one of --input or --input-file.");
    let input: Record<string, unknown>;
    try {
      const raw = values["input-file"]
        ? await readFile(String(values["input-file"]), "utf8")
        : values.input === "-"
          ? await readStdin()
          : String(values.input);
      input = JSON.parse(raw);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    } catch {
      throw new CliError(
        2,
        "INPUT",
        "Input must be a readable JSON object (maximum stdin size: 8 MiB).",
      );
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const result = await invokeApex(input, {
        workspace: values.workspace as string | undefined,
        artifactDir: values["artifact-dir"] as string | undefined,
        timeoutMs: timeout,
        allowEffects: values["allow-effects"] === true,
        resume: values.resume as string | undefined,
        signal: controller.signal,
      });
      output(result);
      return result.error ? exitCodes[result.error.code] : result.ok ? 0 : 5;
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  } catch (error) {
    const known = error instanceof CliError;
    output({
      schemaVersion: 1,
      ok: false,
      error: {
        code: known ? error.kind : "OPERATION",
        message: known
          ? error.message
          : "Tool execution failed. Check the input, workspace, credentials, and tool prerequisites.",
      },
    });
    return known ? error.code : 5;
  }
}

function output(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error("Input too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
