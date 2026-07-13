/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Opt-in live proof that current Gateway routes do not need SF Pi-owned
 * Anthropic beta headers.
 *
 * Enable with SF_LLM_GATEWAY_HEADER_PROOF_LIVE=1 plus a configured gateway
 * base URL and API key. The temporary proof extension records only sanitized
 * header facts (keys and beta counts), never secret values or raw headers.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  API_KEY_ENV,
  BASE_URL_ENV,
  LEGACY_API_KEY_ENV,
  LEGACY_BASE_URL_ENV,
  readGatewayEnv,
} from "../lib/config.ts";

const LIVE_PROOF_ENV = "SF_LLM_GATEWAY_HEADER_PROOF_LIVE";
const ANTHROPIC_MODELS = (
  process.env.SF_LLM_GATEWAY_HEADER_PROOF_ANTHROPIC_MODELS ||
  "claude-opus-4-7,claude-opus-4-8,claude-sonnet-5,claude-opus-4-6-v1"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const NON_ANTHROPIC_MODEL =
  process.env.SF_LLM_GATEWAY_HEADER_PROOF_NON_ANTHROPIC_MODEL || "gpt-5.5";
const TIMEOUT_MS = Number(process.env.SF_LLM_GATEWAY_HEADER_PROOF_TIMEOUT_MS || 180_000);
const hasLiveGatewayConfig =
  process.env[LIVE_PROOF_ENV] === "1" &&
  Boolean(readGatewayEnv(BASE_URL_ENV, LEGACY_BASE_URL_ENV)) &&
  Boolean(readGatewayEnv(API_KEY_ENV, LEGACY_API_KEY_ENV));
const describeLive = hasLiveGatewayConfig ? describe : describe.skip;

interface ProofRecord {
  provider?: string;
  model?: string;
  headerKeys: string[];
  hasAnthropicBeta: boolean;
  betaTokenCount: number;
}

describeLive("sf-llm-gateway no-beta live proof", () => {
  it(
    "runs current Gateway routes without SF Pi-owned Anthropic beta headers",
    () => {
      for (const modelId of ANTHROPIC_MODELS) {
        const small = runPiProof(modelId, {
          prompt: "Reply with exactly: ok",
          thinking: "minimal",
        });
        expect(small.output.toLowerCase()).toContain("ok");
        expectNoBeta(small.record, modelId);

        const thinking = runPiProof(modelId, { prompt: "Reply with exactly: ok", thinking: "max" });
        expect(thinking.output.toLowerCase()).toContain("ok");
        expectNoBeta(thinking.record, modelId);
      }

      const nonAnthropic = runPiProof(NON_ANTHROPIC_MODEL, {
        prompt: "Reply with exactly: ok",
        thinking: "low",
      });
      expect(nonAnthropic.output.toLowerCase()).toContain("ok");
      expect(nonAnthropic.record).toMatchObject({
        provider: "sf-llm-gateway-internal",
        model: NON_ANTHROPIC_MODEL,
        hasAnthropicBeta: false,
        betaTokenCount: 0,
      });
    },
    TIMEOUT_MS * (ANTHROPIC_MODELS.length * 2 + 1),
  );
});

function expectNoBeta(record: ProofRecord, modelId: string): void {
  expect(record).toMatchObject({
    provider: "sf-llm-gateway-internal",
    model: modelId,
    hasAnthropicBeta: false,
    betaTokenCount: 0,
  });
}

function runPiProof(
  modelId: string,
  options: { prompt: string; thinking: string },
): { output: string; record: ProofRecord } {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-gateway-header-proof-"));
  const proofFile = path.join(dir, "proof.jsonl");
  const extensionFile = path.join(dir, "proof-extension.ts");
  writeFileSync(extensionFile, proofExtensionSource(), "utf8");

  const output = execFileSync(
    "pi",
    [
      "--no-extensions",
      "-e",
      path.join(process.cwd(), "extensions/sf-llm-gateway-internal/index.ts"),
      "-e",
      extensionFile,
      "--model",
      `sf-llm-gateway-internal/${modelId}`,
      "--thinking",
      options.thinking,
      "--no-tools",
      "--no-session",
      "-p",
      options.prompt,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        SF_PI_GATEWAY_HEADER_PROOF_FILE: proofFile,
      },
    },
  ).trim();

  const records = readFileSync(proofFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProofRecord);
  const record = records.at(-1);
  if (!record) throw new Error(`No before_provider_headers proof record for ${modelId}.`);
  return { output, record };
}

function proofExtensionSource(): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

const out = process.env.SF_PI_GATEWAY_HEADER_PROOF_FILE;

export default function(pi: ExtensionAPI) {
  pi.on("before_provider_headers", (event, ctx) => {
    const headers = event.headers ?? {};
    const beta = headers["anthropic-beta"];
    const data = {
      provider: ctx.model?.provider,
      model: ctx.model?.id,
      headerKeys: Object.keys(headers).filter((key) => !/authorization|api-key|token/i.test(key)).sort(),
      hasAnthropicBeta: typeof beta === "string" && beta.trim().length > 0,
      betaTokenCount: typeof beta === "string" && beta.trim() ? beta.split(",").filter(Boolean).length : 0,
    };
    if (out) appendFileSync(out, JSON.stringify(data) + "\\n", "utf8");
  });
}
`;
}
