/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for pi-native snapshot summarization. */
import { describe, expect, it } from "vitest";
import { snapshotOutputModeFromUnknown, summarizeSnapshot } from "../lib/snapshot-summary.ts";

describe("snapshot summary", () => {
  it("keeps high-value Salesforce controls and focus matches", () => {
    const snapshot = [
      '- heading "Agentforce Agents" [level=1, ref=e151]',
      '- switch "label" [checked=true, ref=e189]',
      '- button "New Agent" [ref=e175]',
      '- rowheader "Expand Demo Greeter Demo Greeter" [ref=e190]',
      '- gridcell "Service Agent" [ref=e191]',
    ].join("\n");

    const summary = summarizeSnapshot({
      snapshot,
      fullSnapshotPath: "/tmp/snapshot.txt",
      focus: ["Agentforce"],
    });

    expect(summary).toContain("📍 Page:");
    expect(summary).toContain("Full snapshot: /tmp/snapshot.txt");
    expect(summary).toContain('heading "Agentforce Agents"');
    expect(summary).toContain('switch "label" [checked=true, ref=e189]');
    expect(summary).toContain('button "New Agent" [ref=e175]');
    expect(summary).toContain("Rows: Demo Greeter");
  });

  it("classifies URLs and Salesforce surfaces", () => {
    const setup = summarizeSnapshot({
      snapshot: '- heading "Agentforce Agents" [level=1, ref=e151]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce-setup.com/lightning/setup/EinsteinCopilot/home",
    });
    const record = summarizeSnapshot({
      snapshot: '- heading "Acme" [level=1, ref=e1]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/r/Account/001000000000001AAA/view",
    });
    const objectNew = summarizeSnapshot({
      snapshot: '- heading "New Account" [level=2, ref=e1]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/o/Account/new?count=1",
    });

    expect(setup).toContain(
      "URL: https://example.my.salesforce-setup.com/lightning/setup/EinsteinCopilot/home",
    );
    expect(setup).toContain("Lightning Setup page");
    expect(setup).toContain("Surface: setup-page");
    expect(setup).toContain("Setup destination: agentforce-agents");
    expect(record).toContain("Record page");
    expect(record).toContain("Lightning state");
    expect(record).toContain("Surface: record-page");
    expect(record).toContain("Object: Account");
    expect(record).toContain("Record Id: 001000000000001AAA");
    expect(record).toContain("Mode: view");
    expect(objectNew).toContain("Object new page");
    expect(objectNew).toContain("Surface: object-new");
    expect(objectNew).not.toContain("List view");
  });

  it("classifies id-only record URLs and quick action URLs", () => {
    const idOnlyRecord = summarizeSnapshot({
      snapshot: '- heading "Account Acme" [level=1, ref=e1]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/r/001000000000001AAA/view",
    });
    const quickAction = summarizeSnapshot({
      snapshot: '- heading "New Contact" [level=2, ref=e1]',
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/action/quick/Global.NewContact?recordId=001000000000001AAA",
    });

    expect(idOnlyRecord).toContain("Record page");
    expect(idOnlyRecord).toContain("Record Id: 001000000000001AAA");
    expect(idOnlyRecord).toContain("Mode: view");
    expect(quickAction).toContain("Quick action page");
  });

  it("does not classify setup pages as builders from promotional text alone", () => {
    const summary = summarizeSnapshot({
      snapshot: [
        '- heading "Agentforce Agents" [level=1, ref=e1]',
        '- StaticText "Try the new Agentforce Builder!"',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce-setup.com/lightning/setup/EinsteinCopilot/home",
    });

    expect(summary).toContain("Lightning Setup page");
    expect(summary).not.toContain("Builder surface");
  });

  it("preserves validation alert text in compact summaries", () => {
    const snapshot = [
      "- alert",
      '- heading "Please fix the following:" [level=4, ref=e171]',
      '- StaticText "• "',
      '- StaticText "Can\'t assign permission set Agent STDM to user STDM Demo Agent User."',
      '- StaticText "The user license doesn\'t allow the permission: Gives users permission to view Agentforce Optimization."',
    ].join("\n");

    const summary = summarizeSnapshot({ snapshot, fullSnapshotPath: "/tmp/snapshot.txt" });

    expect(summary).toContain("Alerts / validation");
    expect(summary).toContain("Please fix the following");
    expect(summary).toContain("Can't assign permission set Agent STDM");
    expect(summary).toContain("user license doesn't allow");
  });

  it("does not treat navigation/table text containing error words as validation", () => {
    const snapshot = [
      '- treeitem "Delegated Authentication Error History" [level=2, ref=e1]',
      '- option "Revenue Transaction Error Logs" [ref=e2]',
      '- cell "This object cannot be a Master-Detail relationship." [ref=e3]',
    ].join("\n");

    const summary = summarizeSnapshot({ snapshot, fullSnapshotPath: "/tmp/snapshot.txt" });

    expect(summary).not.toContain("Alerts / validation");
    expect(summary).toContain("Validation: none");
  });

  it("redacts emails and non-page URLs from table and focus summaries", () => {
    const snapshot = [
      '- heading "Welcome, Jane," [level=1, ref=e0]',
      '- rowheader "person@example.com" [ref=e1]',
      '- cell "https://example.my.site.com/path" [ref=e2]',
    ].join("\n");

    const summary = summarizeSnapshot({
      snapshot,
      fullSnapshotPath: "/tmp/snapshot.txt",
      focus: ["example"],
    });

    expect(summary).toContain("Welcome, <user>");
    expect(summary).toContain("<email>");
    expect(summary).toContain("<url>");
    expect(summary).not.toContain("Welcome, Jane");
    expect(summary).not.toContain("person@example.com");
    expect(summary).not.toContain("https://example.my.site.com/path");
  });

  it("ignores short focus terms to avoid noisy matches", () => {
    const snapshot = [
      '- link "Skip to Navigation" [ref=e1]',
      '- button "Global Actions" [ref=e2]',
      '- heading "Agentforce Agents" [level=1, ref=e3]',
    ].join("\n");

    const summary = summarizeSnapshot({
      snapshot,
      fullSnapshotPath: "/tmp/snapshot.txt",
      focus: ["On", "Agentforce"],
    });

    const focusSection = summary.split("Key controls:")[0] ?? summary;

    expect(summary).toContain("Ignored short focus terms: On");
    expect(focusSection).not.toContain('link "Skip to Navigation"');
    expect(summary).toContain('heading "Agentforce Agents"');
  });

  it("summarizes record tabs, actions, field edits, and related-list cards", () => {
    const summary = summarizeSnapshot({
      snapshot: [
        '- heading "Account SF Browser Smoke" [level=1, ref=e35]',
        '- tab "Related" [selected, ref=e40]',
        '- tab "Details" [ref=e41]',
        '- button "New Contact" [ref=e48]',
        '- button "New Case" [ref=e49]',
        '- button "Edit Phone" [ref=e73]',
        '- heading "Contacts (1)" [level=2, ref=e73]',
        '- button "New" [ref=e88]',
        '- heading "Browser Smoke Contact Open Browser Smoke Contact Preview" [level=3, ref=e95]',
        '- link "View All Contacts" [ref=e63]',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/r/Account/001000000000001AAA/view",
      focus: ["Phone"],
    });

    expect(summary).toContain("🧭 Tabs:");
    expect(summary).toContain("Related [selected] e40");
    expect(summary).toContain("Details e41");
    expect(summary).toContain("⚡ Record actions:");
    expect(summary).toContain('button "New Contact" [ref=e48]');
    expect(summary).toContain("✏️ Field edit actions:");
    expect(summary).toContain('button "Edit Phone" [ref=e73]');
    expect(summary).toContain("🔗 Related lists:");
    expect(summary).toContain("Contacts (1) [card]");
    expect(summary).toContain("View All e63");
  });

  it("summarizes object-list controls and full related-list pages", () => {
    const listSummary = summarizeSnapshot({
      snapshot: [
        '- heading "Accounts All Accounts" [level=1, ref=e35]',
        '- button "New" [ref=e37]',
        '- button "List View Controls" [expanded=false, ref=e41]',
        '- searchbox "Search this list..." [ref=e44]',
        '- columnheader "Account Name" [ref=e252]',
        '- rowheader "Acme Corp Edit Account Name" [ref=e51]',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/o/Account/list?filterName=AllAccounts",
    });
    const relatedSummary = summarizeSnapshot({
      snapshot: [
        '- heading "Contacts" [level=1, ref=e34]',
        '- button "New" [ref=e38]',
        '- rowheader "Browser Contact Open Browser Contact Preview" [ref=e43]',
        '- button "Show Actions" [expanded=false, ref=e64]',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/r/Account/001000000000001AAA/related/Contacts/view",
    });

    expect(listSummary).toContain("📋 Object list controls:");
    expect(listSummary).toContain("List view heading: Accounts All Accounts");
    expect(listSummary).toContain('button "List View Controls"');
    expect(relatedSummary).toContain("Contacts [full page]");
    expect(relatedSummary).toContain("row action e64");
  });

  it("summarizes quick action forms from URL and required fields", () => {
    const summary = summarizeSnapshot({
      snapshot: [
        '- heading "New Contact" [level=2, ref=e2]',
        '- textbox "Last Name *" [required, ref=e10]',
        '- textbox "Email" [ref=e5]',
        '- button "Cancel" [ref=e3]',
        '- button "Save" [ref=e4]',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
      url: "https://example.my.salesforce.com/lightning/action/quick/Global.NewContact?objectApiName=Contact&context=RECORD_DETAIL&recordId=001000000000001AAA",
    });

    expect(summary).toContain("⚡ Quick action:");
    expect(summary).toContain("Action: Global.NewContact");
    expect(summary).toContain("Object: Contact");
    expect(summary).toContain("Context: RECORD_DETAIL");
    expect(summary).toContain("Parent record: 001000000000001AAA");
    expect(summary).toContain("Required fields: Last Name *");
    expect(summary).toContain('button "Save" [ref=e4]');
  });

  it("surfaces editor hints without treating every textbox as an editor", () => {
    const summary = summarizeSnapshot({
      snapshot: [
        '- textbox "Search Setup" [ref=e1]',
        '- textbox "SIC Code" [ref=e2]',
        '- textbox "Description" [ref=e3]: before browser smoke',
        '- textbox "Agent Script Editor" [ref=e4]',
        '- StaticText "monaco-editor"',
      ].join("\n"),
      fullSnapshotPath: "/tmp/snapshot.txt",
    });

    const editorSection = summary.split("✏️ Editor hints:")[1]?.split("\n\n")[0] ?? "";

    expect(summary).toContain("Editor hints");
    expect(editorSection).toContain("sf_browser_editor action=detect");
    expect(editorSection).toContain('textbox "Agent Script Editor"');
    expect(editorSection).not.toContain('textbox "Search Setup"');
    expect(editorSection).not.toContain('textbox "SIC Code"');
    expect(editorSection).not.toContain('textbox "Description"');
  });

  it("defaults unknown output mode to summary", () => {
    expect(snapshotOutputModeFromUnknown("bad")).toBe("summary");
  });
});
