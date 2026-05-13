/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the custom PermissionSet XML synthesizer.
 *
 * Pure function — no Connection — so these tests just feed inputs and
 * assert deterministic XML output.
 */

import { describe, expect, test } from "vitest";
import { synthesizeCustomPS } from "../lib/agent-user/custom-ps.ts";

describe("synthesizeCustomPS", () => {
  test("emits a stable PermissionSet XML for the documented happy path", () => {
    const r = synthesizeCustomPS({
      agent_name: "AutomotiveSupport",
      apex_classes: [
        "VehicleLookupService",
        "ErrorCodeDiagnosticsService",
        "CheckEngineDiagnosticsService",
      ],
    });
    expect(r.developer_name).toBe("AutomotiveSupport_Access");
    expect(r.label).toBe("AutomotiveSupport Access");
    expect(r.xml).toContain("<PermissionSet");
    expect(r.xml).toContain("<label>AutomotiveSupport Access</label>");
    // Each class gets its own classAccesses block.
    expect(r.xml).toContain("<apexClass>VehicleLookupService</apexClass>");
    expect(r.xml).toContain("<apexClass>ErrorCodeDiagnosticsService</apexClass>");
    expect(r.xml).toContain("<apexClass>CheckEngineDiagnosticsService</apexClass>");
    // hasActivationRequired is always false for our scaffold.
    expect(r.xml).toContain("<hasActivationRequired>false</hasActivationRequired>");
  });

  test("output is stable across permutations of input", () => {
    const a = synthesizeCustomPS({
      agent_name: "X",
      apex_classes: ["B", "A", "C"],
    });
    const b = synthesizeCustomPS({
      agent_name: "X",
      apex_classes: ["C", "A", "B"],
    });
    expect(a.xml).toBe(b.xml);
  });

  test("de-duplicates repeated classes", () => {
    const r = synthesizeCustomPS({
      agent_name: "X",
      apex_classes: ["A", "A", "B"],
    });
    const matches = r.xml.match(/<apexClass>A<\/apexClass>/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("sanitizes non-API characters in agent_name for the developer name", () => {
    const r = synthesizeCustomPS({
      agent_name: "My-Agent_2026",
      apex_classes: ["X"],
    });
    expect(r.developer_name).toBe("My_Agent_2026_Access");
    // Label keeps the original name (cosmetic).
    expect(r.label).toBe("My-Agent_2026 Access");
  });

  test("XML-escapes special characters in the description / label", () => {
    const r = synthesizeCustomPS({
      agent_name: "Bot & Co",
      apex_classes: ["X"],
    });
    // The label keeps human formatting, but the XML must be valid.
    expect(r.xml).toContain("<label>Bot &amp; Co Access</label>");
    expect(r.xml).not.toContain("<label>Bot & Co"); // raw `&` would be invalid XML
  });

  test("empty apex_classes still produces a valid PermissionSet (no classAccesses block)", () => {
    const r = synthesizeCustomPS({
      agent_name: "Empty",
      apex_classes: [],
    });
    expect(r.xml).not.toContain("<apexClass>");
    expect(r.xml).toContain("<PermissionSet");
    expect(r.xml).toContain("</PermissionSet>");
  });
});
