/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { parseApexLog, summarizeLogDigest } from "../lib/log-parser.ts";

const SAMPLE_LOG = `67.0 APEX_CODE,FINEST;DB,INFO;SYSTEM,DEBUG
08:17:00.1 (1000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|SfApexHarnessService.processRecords
08:17:00.2 (2000000)|METHOD_ENTRY|[16]|01pxx|SfApexHarnessService.processRecords(Set<Id>, String)
08:17:00.3 (3000000)|SOQL_EXECUTE_BEGIN|[51]|Aggregations:0|SELECT Id FROM SfApexHarness__c
08:17:00.3 (3500000)|SOQL_EXECUTE_END|[51]|Rows:1
08:17:00.4 (4000000)|DML_BEGIN|[91]|Op:Update|Type:SfApexHarness__c|Rows:1
08:17:00.4 (4500000)|DML_END|[91]
08:17:00.4 (14639647)|USER_DEBUG|[12]|DEBUG|hello apex
08:17:00.14 (14764880)|CUMULATIVE_LIMIT_USAGE
  Number of SOQL queries: 2 out of 100
  Number of DML statements: 1 out of 150
  Maximum CPU time: 15 out of 10000
  Maximum heap size: 3000 out of 6000000
08:17:00.14 (14764880)|CUMULATIVE_LIMIT_USAGE_END`;

describe("parseApexLog", () => {
  it("extracts debug lines and key governor limits", () => {
    const digest = parseApexLog(SAMPLE_LOG, { log_id: "07Lxx" });

    expect(digest.log_id).toBe("07Lxx");
    expect(digest.counts.user_debug).toBe(1);
    expect(digest.user_debug[0]).toMatchObject({ line: 12, level: "DEBUG", message: "hello apex" });
    expect(digest.counts.soql).toBe(2);
    expect(digest.counts.dml).toBe(1);
    expect(digest.counts.cpu_ms).toBe(15);
    expect(digest.counts.heap_bytes).toBe(3000);
  });

  it("extracts high-signal runtime timeline events", () => {
    const digest = parseApexLog(
      `${SAMPLE_LOG}\n08:17:00.5 (15000000)|FLOW_START_INTERVIEW_BEGIN|00Dxx|SfApexHarnessFlow`,
    );

    expect(digest.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "code_unit", label: "code unit" }),
        expect.objectContaining({ kind: "method", label: "method" }),
        expect.objectContaining({
          kind: "soql",
          label: "soql",
          detail: expect.stringContaining("SELECT Id"),
        }),
        expect.objectContaining({
          kind: "dml",
          label: "dml",
          detail: expect.stringContaining("Op:Update"),
        }),
        expect.objectContaining({
          kind: "flow",
          label: "flow",
          detail: expect.stringContaining("start_interview_begin"),
        }),
      ]),
    );
  });

  it("summarizes compactly for the LLM", () => {
    const summary = summarizeLogDigest(parseApexLog(SAMPLE_LOG));

    expect(summary).toContain("1 debug line(s)");
    expect(summary).toContain("SOQL 2");
    expect(summary).toContain("hello apex");
  });
});
