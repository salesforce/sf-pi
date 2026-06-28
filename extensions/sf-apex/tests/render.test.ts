/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildApexDigest } from "../lib/digest.ts";
import { renderApexResultMarkdown } from "../lib/render.ts";
import type { ToolResult } from "../lib/types.ts";

function resultWithDigest(digest: ReturnType<typeof buildApexDigest>): ToolResult {
  return {
    content: [{ type: "text", text: "compact summary" }],
    details: { ok: true, digest },
  };
}

describe("renderApexResultMarkdown", () => {
  it("renders native discovery cards", () => {
    const text = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "test.discover",
          kind: "test_discover",
          status: "pass",
          icon: "🧪",
          title: "Apex Test Discovery · candidates",
          orgAlias: "MyDevOrg",
          apiCalls: [
            {
              method: "GET",
              path: "/tooling/query ApexClass",
              detail: "candidate tests · limit=10",
            },
          ],
          sections: [
            {
              icon: "🎯",
              title: "Discovery Scope",
              rows: [{ icon: "📊", label: "Found", value: "3 candidate(s)" }],
            },
            {
              icon: "🧪",
              title: "Candidates",
              rows: [{ icon: "✅", label: "Primary", value: "IssueClassifierTest" }],
            },
          ],
          nextRows: [
            { icon: "🧭", label: "Recommend", value: "run the smallest useful candidate" },
          ],
        }),
      ),
    );

    expect(text).toContain("✅ 🧪 Apex Test Discovery · candidates · MyDevOrg");
    expect(text).toContain("   API");
    expect(text).toContain("│ GET      /tooling/query ApexClass   candidate tests · limit=10");
    expect(text).toContain("—— 🎯 Discovery Scope ——");
    expect(text).toContain("—— 🧪 Candidates ——");
    expect(text).toContain("IssueClassifierTest");
  });

  it("renders an SF Apex lifecycle readiness card", () => {
    const text = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "status",
          kind: "status",
          status: "pass",
          icon: "⚡",
          title: "SF Apex Lifecycle · ready",
          orgAlias: "MyDevOrg",
          apiVersion: "67.0",
          sections: [
            {
              icon: "✅",
              title: "Readiness",
              rows: [{ icon: "🟢", label: "Connection", value: "ready" }],
            },
            {
              icon: "🔁",
              title: "Available Loop",
              rows: [{ icon: "🧭", label: "Plan", value: "author.plan" }],
            },
          ],
          nextRows: [{ icon: "🧭", label: "Recommend", value: "start with author.plan" }],
        }),
      ),
    );

    expect(text).toContain("✅ ⚡ SF Apex Lifecycle · ready · MyDevOrg");
    expect(text).toContain("—— ✅ Readiness ——");
    expect(text).toContain("—— 🔁 Available Loop ——");
    expect(text).toContain("author.plan");
  });

  it("renders an Apex lifecycle flight plan", () => {
    const text = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "author.plan",
          kind: "author_plan",
          status: "info",
          icon: "🧭",
          title: "Apex Lifecycle Flight Plan",
          mode: "Local planning",
          sections: [
            {
              icon: "🎯",
              title: "Mission",
              rows: [{ icon: "🎯", label: "Goal", value: "Add validation" }],
            },
            {
              icon: "🛣️",
              title: "Route",
              rows: [{ icon: "2️⃣", label: "Gate", value: "sf_apex diagnose.file" }],
            },
            {
              icon: "🛡️",
              title: "Guardrails",
              rows: [{ icon: "⚡", label: "Native", value: "prefer sf_apex over raw sf CLI" }],
            },
          ],
          nextRows: [
            { icon: "🧭", label: "Recommend", value: "edit target, then run Apex File Gate" },
          ],
        }),
      ),
    );

    expect(text).toContain("ℹ️ 🧭 Apex Lifecycle Flight Plan");
    expect(text).toContain("—— 🎯 Mission ——");
    expect(text).toContain("—— 🛣️ Route ——");
    expect(text).toContain("—— 🛡️ Guardrails ——");
    expect(text).toContain("prefer sf_apex over raw sf CLI");
  });

  it("renders an expanded passing test report", () => {
    const text = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "test.run",
          kind: "apex_test",
          status: "pass",
          icon: "🧪",
          title: "Apex Test Run · passed",
          orgAlias: "MyDevOrg",
          apiVersion: "67.0",
          meta: ["run=707xx…", "4.6s"],
          sections: [
            {
              icon: "🧾",
              title: "Run Summary",
              rows: [
                { icon: "✅", label: "Outcome", value: "44/44 passing" },
                { icon: "📦", label: "Scope", value: "14 classes · 44 methods" },
              ],
            },
            {
              icon: "🧯",
              title: "Failures",
              rows: [{ icon: "✅", label: "None", value: "all methods passed" }],
            },
            {
              icon: "🐢",
              title: "Slowest Methods",
              rows: [{ icon: "🐢", label: "1.", value: "testHappyPath · 812ms" }],
            },
          ],
          evidenceRows: [
            { icon: "🧾", label: "Run Id", value: "707xx000" },
            { icon: "📁", label: "Saved", value: "1 artifact · tests" },
          ],
          nextRows: [
            { icon: "🧭", label: "Recommend", value: "widen related tests or stop trace" },
          ],
        }),
      ),
    );

    expect(text).toContain("✅ 🧪 Apex Test Run · passed · MyDevOrg · run=707xx… · 4.6s");
    expect(text).toContain("—— 🧾 Run Summary ——");
    expect(text).toContain("—— 🧯 Failures ——");
    expect(text).toContain("—— 🐢 Slowest Methods ——");
    expect(text).not.toContain("—— 🔎 Evidence ——");
    expect(text).not.toContain("—— ➡️ Next ——");
  });

  it("renders an expanded failing test report", () => {
    const text = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "test.result",
          kind: "apex_test",
          status: "fail",
          icon: "🧪",
          title: "Apex Test Run · failed",
          sections: [
            {
              icon: "🧾",
              title: "Run Summary",
              rows: [{ icon: "❌", label: "Outcome", value: "3/4 passing · 1 failing" }],
            },
            {
              icon: "🧯",
              title: "Failures",
              rows: [{ icon: "🔥", label: "testNullInput", value: "Expected fallback" }],
            },
          ],
          nextRows: [{ icon: "🧭", label: "Recommend", value: "inspect failures" }],
        }),
      ),
    );

    expect(text).toContain("❌ 🧪 Apex Test Run · failed");
    expect(text).toContain("—— 🧯 Failures ——");
    expect(text).not.toContain("inspect failures");
  });

  it("renders a failure log root cause section", () => {
    const text = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "log.get",
          kind: "apex_log",
          status: "fail",
          icon: "🔎",
          title: "Apex Log Timeline · failed",
          sections: [
            {
              icon: "🔥",
              title: "Root Cause",
              rows: [
                { icon: "🔥", label: "Type", value: "System.DmlException" },
                { icon: "💬", label: "Message", value: "restricted picklist" },
                { icon: "↩️", label: "Rollback", value: "observed in debug markers" },
              ],
            },
          ],
        }),
      ),
    );

    expect(text).toContain("❌ 🔎 Apex Log Timeline · failed");
    expect(text).toContain("—— 🔥 Root Cause ——");
    expect(text).toContain("System.DmlException");
    expect(text).toContain("observed in debug markers");
  });

  it("renders clean log and Anonymous Apex reports", () => {
    const log = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "log.latest",
          kind: "apex_log",
          status: "pass",
          icon: "🔎",
          title: "Apex Log Timeline · clean",
          summaryRows: [{ icon: "✅", label: "Outcome", value: "0 exception(s)" }],
          signalRows: [{ icon: "💬", label: "Debug", value: "6 line(s)" }],
        }),
      ),
    );
    const anon = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "anon.run",
          kind: "anonymous_apex",
          status: "pass",
          icon: "⚡",
          title: "Anonymous Apex Report · succeeded",
          summaryRows: [{ icon: "🛡️", label: "Risk", value: "non-mutating probe" }],
        }),
      ),
    );

    expect(log).toContain("✅ 🔎 Apex Log Timeline · clean");
    expect(log).toContain("💬 Debug");
    expect(anon).toContain("✅ ⚡ Anonymous Apex Report · succeeded");
    expect(anon).toContain("non-mutating probe");
  });

  it("renders trace and diagnostics reports", () => {
    const trace = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "trace.stop",
          kind: "trace",
          status: "pass",
          icon: "🛰️",
          title: "Trace Capture · stopped",
          sections: [
            {
              icon: "🛰️",
              title: "Capture",
              rows: [{ icon: "✅", label: "Cleanup", value: "stopped 1 trace flag" }],
            },
          ],
        }),
      ),
    );
    const diagnostics = renderApexResultMarkdown(
      resultWithDigest(
        buildApexDigest({
          action: "diagnose.file",
          kind: "diagnostics",
          status: "pass",
          icon: "🧠",
          title: "Apex File Gate · passed",
          mode: "Managed Apex LSP",
          sections: [
            {
              icon: "🚦",
              title: "Gate",
              rows: [{ icon: "🟢", label: "Status", value: "safe to test" }],
            },
          ],
        }),
      ),
    );

    expect(trace).toContain("✅ 🛰️ Trace Capture · stopped");
    expect(trace).toContain("—— 🛰️ Capture ——");
    expect(diagnostics).toContain("✅ 🧠 Apex File Gate · passed");
    expect(diagnostics).toContain("—— 🚦 Gate ——");
    expect(diagnostics).not.toContain("—— 🔎 Evidence ——");
  });

  it("falls back to compact text when digest is missing", () => {
    expect(
      renderApexResultMarkdown({
        content: [{ type: "text", text: "Apex tests passed: 1/1 passing." }],
        details: { ok: true },
      }),
    ).toBe("Apex tests passed: 1/1 passing.");
  });
});
