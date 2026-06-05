/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for slack_schedule — public Web API scheduled messages. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeGatedTools } from "../lib/scope-probe.ts";
import { summarizeSlackError } from "../lib/api.ts";

const libDir = path.resolve(fileURLToPath(import.meta.url), "../../lib");
const scheduleSource = readFileSync(path.join(libDir, "schedule-tool.ts"), "utf-8");
const apiSource = readFileSync(path.join(libDir, "api.ts"), "utf-8");
const typesSource = readFileSync(path.join(libDir, "types.ts"), "utf-8");
const indexSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("slack_schedule scope gating", () => {
  it("gates slack_schedule when chat:write is not granted", () => {
    const granted = new Set(["users:read", "search:read.public", "channels:read"]);
    const gated = computeGatedTools(granted, ["slack_schedule", "slack_user"]);
    expect(gated).toContain("slack_schedule");
  });

  it("does not gate slack_schedule when chat:write is granted on a user token", () => {
    const granted = new Set(["chat:write", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_schedule", "slack_user"], "user");
    expect(gated).not.toContain("slack_schedule");
  });

  it("gates slack_schedule for bot tokens even with chat:write", () => {
    const granted = new Set(["chat:write", "users:read"]);
    const gated = computeGatedTools(granted, ["slack_schedule"], "bot");
    expect(gated).toContain("slack_schedule");
  });
});

describe("slack_schedule source-level safety invariants", () => {
  it("registers the new tool behind sf-slack's token gate", () => {
    expect(indexSource).toContain("registerScheduleTool(pi)");
    expect(indexSource).toContain('from "./lib/schedule-tool.ts"');
  });

  it("declares a schedule/list/delete action schema", () => {
    expect(typesSource).toContain("SlackScheduleParams");
    expect(typesSource).toMatch(/StringEnum\(\["schedule", "list", "delete"\]/);
    expect(typesSource).toContain("scheduled_message_id");
    expect(typesSource).toContain("post_at");
  });

  it("uses supported chat.* scheduled-message endpoints", () => {
    expect(apiSource).toContain('"chat.scheduleMessage"');
    expect(apiSource).toContain('"chat.scheduledMessages.list"');
    expect(apiSource).toContain('"chat.deleteScheduledMessage"');
    expect(scheduleSource).toMatch(/chatScheduleMessage\s*\(/);
    expect(scheduleSource).toMatch(/chatScheduledMessagesList\s*\(/);
    expect(scheduleSource).toMatch(/chatDeleteScheduledMessage\s*\(/);
  });

  it("does not use Slack internal drafts APIs for the PR-safe implementation", () => {
    expect(scheduleSource).not.toMatch(/drafts\.create/);
    expect(scheduleSource).not.toMatch(/drafts\.list/);
    expect(scheduleSource).not.toMatch(/drafts\.delete/);
  });

  it("requires confirmation or explicit headless opt-in for write actions", () => {
    expect(scheduleSource).toContain("SLACK_ALLOW_HEADLESS_SEND");
    expect(scheduleSource).toMatch(/ctx\.ui\.confirm\s*\(/);
    expect(scheduleSource).toMatch(/headless_refused/);
  });

  it("supports dry-run before calling chat.scheduleMessage", () => {
    expect(scheduleSource).toContain("SLACK_SEND_DRY_RUN");
    const dryRunIdx = scheduleSource.indexOf("ENV_SEND_DRY_RUN");
    const scheduleIdx = scheduleSource.indexOf("chatScheduleMessage(token");
    expect(dryRunIdx).toBeGreaterThan(0);
    expect(scheduleIdx).toBeGreaterThan(dryRunIdx);
  });

  it("validates Slack's scheduling window locally", () => {
    expect(scheduleSource).toContain("MIN_SCHEDULE_LEAD_SECONDS");
    expect(scheduleSource).toContain("MAX_SCHEDULE_AHEAD_SECONDS");
    expect(scheduleSource).toContain("post_at_too_soon");
    expect(scheduleSource).toContain("post_at_too_far");
    expect(scheduleSource).toContain("post_at_milliseconds");
  });

  it("records a schedule audit entry", () => {
    expect(scheduleSource).toContain("SCHEDULE_ENTRY_TYPE");
    expect(scheduleSource).toMatch(/pi\.appendEntry<SlackScheduleAuditEntry>/);
  });
});

describe("scheduled-message error summaries", () => {
  it("explains schedule-specific Slack errors", () => {
    expect(summarizeSlackError("time_in_past")).toMatch(/past/);
    expect(summarizeSlackError("time_too_far")).toMatch(/120 days/);
    expect(summarizeSlackError("restricted_too_many")).toMatch(/too many messages/);
    expect(summarizeSlackError("invalid_scheduled_message_id")).toMatch(/scheduled message/);
  });
});
