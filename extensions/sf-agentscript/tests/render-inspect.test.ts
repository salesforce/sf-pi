/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { inspectStructureMarkdown } from "../lib/render/inspect.ts";

describe("inspectStructureMarkdown", () => {
  it("renders the file header with dialect", () => {
    const md = inspectStructureMarkdown({
      ok: true,
      path: "/path/to/Pi_E2E_Final_Test.agent",
      dialect: { name: "agentforce-default", version: "1" },
      components: { topics: [], subagents: [], variables: [], actions: [] },
      stats: { topics: 0, subagents: 0, variables: 0, actions: 0 },
    });
    expect(md).toMatch(/Pi_E2E_Final_Test\.agent/);
    expect(md).toMatch(/agentforce-default 1/);
  });

  it("renders topics with line numbers and cross-references", () => {
    const md = inspectStructureMarkdown({
      ok: true,
      path: "/x.agent",
      dialect: { name: "agentforce-default" },
      components: {
        topics: [
          {
            name: "Triage",
            line: 18,
            description: "Initial routing topic",
            subagent_refs: ["Billing", "AccountSecurity"],
            action_refs: ["lookup_balance"],
            variable_refs: [],
          },
          {
            name: "Billing",
            line: 41,
            action_refs: [],
            subagent_refs: [],
            variable_refs: ["user_id"],
          },
        ],
        subagents: [],
        variables: [],
        actions: [],
      },
      stats: { topics: 2, subagents: 0, variables: 1, actions: 1 },
    });
    expect(md).toMatch(/topics \(2\)/);
    expect(md).toMatch(/Triage/);
    expect(md).toMatch(/L18/);
    expect(md).toMatch(/Billing/);
    expect(md).toMatch(/L41/);
    expect(md).toMatch(/Billing, AccountSecurity/);
    expect(md).toMatch(/lookup_balance/);
    expect(md).toMatch(/user_id/);
  });

  it("renders subagents/actions/variables sections", () => {
    const md = inspectStructureMarkdown({
      ok: true,
      path: "/x.agent",
      components: {
        topics: [],
        subagents: [{ name: "Helper", line: 50 }],
        variables: [{ name: "uid", type: "string", line: 8, mutable: true }],
        actions: [{ name: "lookup", line: 60 }],
      },
      stats: { topics: 0, subagents: 1, variables: 1, actions: 1 },
    });
    expect(md).toMatch(/subagents \(1\)/);
    expect(md).toMatch(/Helper/);
    expect(md).toMatch(/actions \(1\)/);
    expect(md).toMatch(/lookup/);
    expect(md).toMatch(/variables \(1\)/);
    expect(md).toMatch(/uid/);
    expect(md).toMatch(/string, mutable/);
  });

  it("warns when parse errors are present", () => {
    const md = inspectStructureMarkdown({
      ok: true,
      path: "/x.agent",
      components: { topics: [], subagents: [], variables: [], actions: [] },
      stats: { topics: 0, subagents: 0, variables: 0, actions: 0 },
      has_parse_errors: true,
      parse_error_count: 3,
    });
    expect(md).toMatch(/⚠/);
    expect(md).toMatch(/3 parse error/);
    expect(md).toMatch(/agentscript_authoring compile\/check/);
  });

  it("footer aggregates stats and refs", () => {
    const md = inspectStructureMarkdown({
      ok: true,
      path: "/x.agent",
      components: {
        topics: [{ name: "T1", action_refs: ["a"], subagent_refs: ["b"], variable_refs: ["c"] }],
        subagents: [],
        variables: [],
        actions: [],
      },
      stats: { topics: 1, subagents: 0, variables: 1, actions: 1 },
    });
    expect(md).toMatch(/1 topics/);
    expect(md).toMatch(/3 @-refs/);
  });
});
