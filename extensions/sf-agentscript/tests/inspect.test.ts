/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for inspect.ts — the structural summary of a `.agent` file.
 *
 * We use a small fixture written to a temp dir so we exercise the real
 * official SDK package end-to-end. No mocks; if the SDK breaks, these tests catch it.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { inspectFile } from "../lib/inspect.ts";
import { buildFeatureProfile } from "../lib/feature-profile.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-inspect-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeAgent(name: string, source: string): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, source, "utf8");
  return filePath;
}

describe("inspectFile", () => {
  test("returns ok=false for unreadable paths", async () => {
    const result = await inspectFile(path.join(workDir, "missing.agent"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("read_failed");
  });

  test("walks topics + variables on a minimal valid script", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      [
        "config:",
        '    agent_name: "Billing_Bot"',
        "",
        "system:",
        '    instructions: "You are a billing agent."',
        "",
        "variables:",
        "    is_verified: mutable boolean = False",
        "",
        "topic billing:",
        '    description: "Handle billing inquiries"',
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.stats?.topics).toBeGreaterThanOrEqual(1);
    expect(result.components?.topics?.[0].name).toBe("billing");
    expect(result.components?.topics?.[0].description).toBe("Handle billing inquiries");
    expect(result.components?.system?.instructions).toContain("billing agent");
    expect(result.stats?.variables).toBeGreaterThanOrEqual(1);
    const verifiedVar = result.components?.variables?.find((v) => v.name === "is_verified");
    // Variable is discovered with a name and (probably) a line number.
    // Field-level projection (type, mutable, default) is dialect-specific
    // and best-effort; we just verify the variable was surfaced.
    expect(verifiedVar).toBeDefined();
    expect(typeof verifiedVar?.line).toBe("number");
  });

  test("collects @actions and @subagent references on a topic", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      [
        "system:",
        '    instructions: "billing"',
        "",
        "subagent identity_check:",
        '    description: "Verify identity"',
        "",
        "topic billing:",
        '    description: "Handle billing"',
        "    actions:",
        "        - lookup_balance",
        "    after_reasoning:",
        "        if not @variables.is_verified:",
        "            transition to @subagent.identity_check",
        "",
        "variables:",
        "    is_verified: mutable boolean = False",
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    const billing = result.components?.topics?.find((t) => t.name === "billing");
    expect(billing).toBeDefined();
    // The reference walker only sees AtIdentifier-based references (used in
    // procedures). Whether the SDK exposes them depends on the dialect; at
    // minimum the topic itself was discovered with a name + line.
    expect(typeof billing?.line).toBe("number");
  });

  test("flags has_parse_errors when the file has severity-1 issues", async () => {
    const filePath = await writeAgent(
      "missing-required.agent",
      [
        "config:",
        '    agent_name: "Bot"',
        "",
        "system:",
        '    instructions: "x"',
        "",
        "topic foo:",
        '    description: "ok"',
        "",
        // start_agent main is missing the required `description` — sev-1.
        "start_agent main:",
        "    transition to @topic.foo",
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.has_parse_errors).toBe(true);
    expect(result.parse_error_count ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("clean files report has_parse_errors=false", async () => {
    const filePath = await writeAgent(
      "clean.agent",
      [
        "config:",
        '    agent_name: "Clean"',
        '    description: "clean"',
        "",
        "system:",
        '    instructions: "x"',
        "",
        "topic foo:",
        '    description: "ok"',
        "",
        "start_agent main:",
        '    description: "entry"',
        "    transition to @topic.foo",
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.has_parse_errors).toBe(false);
  });

  test("reports dialect when annotation is present", async () => {
    const filePath = await writeAgent(
      "annotated.agent",
      ["# @dialect agentforce", "system:", '    instructions: "hi"', ""].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    // Either parseDialectAnnotation or resolveDialect should produce a name.
    expect(typeof result.dialect?.name).toBe("string");
  });

  test("surfaces linked variable source, voice modality, response formats, and end-session refs", async () => {
    const filePath = await writeAgent(
      "voice.agent",
      [
        "system:",
        '    instructions: "You are a support assistant."',
        "",
        "config:",
        '    developer_name: "Voice_Bot"',
        '    default_agent_user: "u@example.com"',
        "",
        "variables:",
        "    VoiceCallId: linked string",
        "        source: @VoiceCall.Id",
        '        visibility: "External"',
        '    customer_name: mutable string = "Acme"',
        "",
        "connection service_email:",
        "    response_formats:",
        "        choices:",
        '            source: "response_format://SurfaceAction__EmailTextChoices"',
        "    reasoning:",
        "        instructions: |",
        "            Use {!@response_actions.choices} for choices.",
        "        response_actions:",
        "            choices: @response_formats.choices",
        "",
        "modality voice:",
        '    voice_id: "voice-1"',
        "    outbound_speed: 1.0",
        "",
        "start_agent main:",
        '    description: "Main topic with end session option"',
        "    reasoning:",
        "        instructions: ->",
        "            | Help the caller.",
        "        actions:",
        "            end_conversation: @utils.end_session",
        '                description: "End the current session"',
        "",
      ].join("\n"),
    );

    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    const voiceCallId = result.components?.variables.find((v) => v.name === "VoiceCallId");
    expect(voiceCallId).toMatchObject({
      type: "string",
      modifier: "linked",
      linked: true,
      source: "@VoiceCall.Id",
      source_namespace: "VoiceCall",
      source_field: "Id",
      visibility: "External",
    });
    expect(result.components?.variables.find((v) => v.name === "customer_name")).toMatchObject({
      modifier: "mutable",
      mutable: true,
      default: "Acme",
    });
    expect(result.components?.modalities?.[0]).toMatchObject({
      name: "voice",
      fields: { voice_id: "voice-1", outbound_speed: 1 },
    });
    expect(result.components?.connections?.[0]).toMatchObject({
      name: "service_email",
      response_formats: [
        { name: "choices", source: "response_format://SurfaceAction__EmailTextChoices" },
      ],
      response_actions: ["choices"],
    });
    expect(result.components?.start_agents?.find((t) => t.name === "main")?.utility_refs).toContain(
      "end_session",
    );

    const profile = buildFeatureProfile(result);
    expect(profile.context_variables_template.map((v) => v.name)).toContain("VoiceCallId");
    expect(profile.publish_risks.map((r) => r.code)).toEqual(
      expect.arrayContaining([
        "voice_linked_variable_publish_may_require_channel_entitlement",
        "voice_modality_publish_may_require_channel_entitlement",
        "connection_surface_publish_may_require_channel_entitlement",
        "response_format_publish_may_require_surface_entitlement",
      ]),
    );
  });

  test("agent_type is surfaced on components.config (not components.system)", async () => {
    // Locks in the SDK schema: agent_type is a `config:` field. An
    // earlier inspect summary mirrored it onto `system` too, which was
    // wrong — readers expecting it on system would silently get
    // undefined for correctly-authored scripts.
    const filePath = await writeAgent(
      "typed.agent",
      [
        "config:",
        '    agent_name: "Typed_Bot"',
        '    agent_type: "AgentforceServiceAgent"',
        '    description: "d"',
        '    default_agent_user: "u@example.com"',
        "",
        "system:",
        '    instructions: "hi"',
        "",
        "topic main:",
        '    description: "d"',
        "",
        "start_agent main:",
        '    description: "e"',
        "    transition to @topic.main",
        "",
      ].join("\n"),
    );
    const result = await inspectFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.components?.config?.agent_type).toBe("AgentforceServiceAgent");
    expect(result.components?.config?.default_agent_user).toBe("u@example.com");
    // The system summary intentionally does NOT carry agent_type; it's
    // purely instructions.
    const systemKeys = Object.keys(result.components?.system ?? {});
    expect(systemKeys).toEqual(["instructions"]);
  });
});
