/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source-level audits for the post-optimization prompt surface.
 *
 * These tests lock in the prompt-footprint rules we decided on:
 *   1. Cross-tool routing guidance lives on the `slack` tool alone.
 *   2. slack_research carries the Slack search-operator syntax.
 *   3. slack_time_range carries a single "use these return fields" bullet.
 *   4. slack_user action names are qualified ("slack_user action:'list'").
 *   5. The big-output truncation suffix is only on slack, slack_research,
 *      and slack_canvas descriptions.
 *
 * We test at the source level because ExtensionAPI instantiation requires
 * a full pi runtime that isn't available in the unit-test environment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const libDir = path.resolve(fileURLToPath(import.meta.url), "../../lib");
const read = (file: string) => readFileSync(path.join(libDir, file), "utf-8");

const sources: Record<string, string> = {
  slack: read("tools.ts"),
  research: read("research-tool.ts"),
  resolve: read("resolve-tool.ts"),
  timeRange: read("time-range-tool.ts"),
  user: read("user-tool.ts"),
  channel: read("channel-tool.ts"),
  file: read("file-tool.ts"),
  canvas: read("canvas-tool.ts"),
};

describe("prompt-surface — cross-tool routing has a single owner", () => {
  it("slack tool owns the 'prefer slack_research' routing rule", () => {
    expect(sources.slack).toMatch(/Prefer slack_research for natural-language/);
  });

  it("slack tool owns the 'use slack_resolve for fuzzy refs' rule", () => {
    expect(sources.slack).toMatch(/Use slack_resolve to turn a fuzzy/);
  });

  it("slack tool owns the 'use slack_time_range first' rule", () => {
    expect(sources.slack).toMatch(/Use slack_time_range first for any relative/);
  });

  it("slack_research no longer duplicates the 'use slack_research instead of raw operators' rule", () => {
    expect(sources.research).not.toMatch(
      /Use slack_research for natural-language Slack research tasks instead of/,
    );
  });

  it("slack_resolve no longer duplicates routing guidance", () => {
    expect(sources.resolve).not.toMatch(/Use slack_resolve when a user provides a fuzzy/);
    expect(sources.resolve).not.toMatch(/Prefer slack_research for natural-language/);
  });

  it("slack_time_range has a single merged guideline, not the old three", () => {
    // Content-based check: the single bullet we want exists, and the three
    // bullets from before the merge do NOT. Regex-counting string literals is
    // unreliable because apostrophes inside the bullet (e.g. action:'history')
    // look like extra quote delimiters.
    expect(sources.timeRange).toMatch(
      /slack_time_range returns oldest\/latest for slack action:'history'/,
    );
    expect(sources.timeRange).not.toMatch(/Use slack_time_range before calling slack history when/);
    expect(sources.timeRange).not.toMatch(
      /Use slack_time_range before composing raw Slack search date operators/,
    );
    expect(sources.timeRange).not.toMatch(/Do not use bash, Python, or manual arithmetic/);
  });
});

describe("prompt-surface — search-operator syntax lives on slack_research", () => {
  it("slack_research teaches Slack search operators", () => {
    expect(sources.research).toMatch(/in:#channel/);
    expect(sources.research).toMatch(/from:@Name/);
    expect(sources.research).toMatch(/after:YYYY-MM-DD/);
    expect(sources.research).toMatch(/is:thread/);
  });

  it("slack tool no longer teaches raw Slack search operators", () => {
    // The slack tool used to spell out in:/from:/has:/before:/during:/is:thread.
    // After the refactor that syntax lives on slack_research.
    expect(sources.slack).not.toMatch(/`in:#channel-name`/);
    expect(sources.slack).not.toMatch(/`has:reaction`/);
    expect(sources.slack).not.toMatch(/`during:march`/);
  });
});

describe("prompt-surface — slack_user action names are qualified", () => {
  it("slack_user guidelines prefix actions with the tool name", () => {
    expect(sources.user).toMatch(/slack_user action:'list'/);
    expect(sources.user).toMatch(/slack_user action:'email'/);
  });

  it("slack_user guidelines no longer use bare action names", () => {
    // "Use action 'list' with ..." is ambiguous in the flat Guidelines block.
    expect(sources.user).not.toMatch(/^\s*"Use action 'list'/m);
    expect(sources.user).not.toMatch(/^\s*"Use action 'email'/m);
  });
});

describe("prompt-surface — truncation suffix restricted to big-output tools", () => {
  it("keeps the suffix on slack, slack_research, slack_canvas", () => {
    expect(sources.slack).toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
    expect(sources.research).toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
    expect(sources.canvas).toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
  });

  it("drops the suffix from slack_resolve, slack_time_range, slack_user, slack_channel, slack_file", () => {
    expect(sources.resolve).not.toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
    expect(sources.timeRange).not.toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
    expect(sources.user).not.toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
    expect(sources.channel).not.toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
    expect(sources.file).not.toContain("SLACK_OUTPUT_DESCRIPTION_SUFFIX");
  });
});
