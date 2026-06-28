/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { classifyAnonymousApex } from "../lib/anonymous.ts";
import { buildSoapBody, parseSoapExecuteAnonymousResponse } from "../lib/anonymous-soap.ts";

describe("classifyAnonymousApex", () => {
  it("allows read-only probes", () => {
    expect(classifyAnonymousApex("System.debug(UserInfo.getUserId());")).toEqual({
      mutating: false,
      reasons: [],
    });
  });

  it("flags DML and async work", () => {
    const risk = classifyAnonymousApex(
      "insert new Account(Name = 'Example'); System.enqueueJob(new MyJob());",
    );

    expect(risk.mutating).toBe(true);
    expect(risk.reasons).toContain("DML keyword");
    expect(risk.reasons).toContain("async enqueue");
  });
});

describe("SOAP anonymous Apex", () => {
  it("builds an escaped SOAP anonymous request", () => {
    const body = buildSoapBody("00D!token", "System.debug('x < y && y > z');");

    expect(body).toContain("<cmd:sessionId>00D!token</cmd:sessionId>");
    expect(body).toContain("System.debug(&apos;x &lt; y &amp;&amp; y &gt; z&apos;);");
    expect(body).toContain("<apex:DebuggingHeader>");
  });

  it("parses a successful SOAP response with debug log", () => {
    const result = parseSoapExecuteAnonymousResponse(`
      <soapenv:Envelope>
        <soapenv:Header><DebuggingInfo><debugLog>55.0 APEX_CODE,FINEST\nUSER_DEBUG|[1]|DEBUG|hello &amp;amp; world</debugLog></DebuggingInfo></soapenv:Header>
        <soapenv:Body><executeAnonymousResponse><result>
          <compiled>true</compiled><success>true</success><line>1</line><column>1</column>
        </result></executeAnonymousResponse></soapenv:Body>
      </soapenv:Envelope>`);

    expect(result.compiled).toBe(true);
    expect(result.success).toBe(true);
    expect(result.logs).toContain("hello &amp; world");
  });

  it("parses SOAP compile failures", () => {
    const result = parseSoapExecuteAnonymousResponse(`
      <env:Envelope><env:Body><executeAnonymousResponse><result>
        <compiled>false</compiled><success>false</success><line>2</line><column>7</column>
        <compileProblem>Unexpected token &apos;bad&apos;.</compileProblem>
      </result></executeAnonymousResponse></env:Body></env:Envelope>`);

    expect(result.compiled).toBe(false);
    expect(result.success).toBe(false);
    expect(result.line).toBe(2);
    expect(result.column).toBe(7);
    expect(result.compileProblem).toBe("Unexpected token 'bad'.");
  });

  it("parses SOAP runtime exceptions", () => {
    const result = parseSoapExecuteAnonymousResponse(`
      <env:Envelope><env:Body><executeAnonymousResponse><result>
        <compiled>true</compiled><success>false</success><line>1</line><column>1</column>
        <exceptionMessage>System.NullPointerException: boom</exceptionMessage>
        <exceptionStackTrace>Class.Example.run: line 3</exceptionStackTrace>
      </result></executeAnonymousResponse></env:Body></env:Envelope>`);

    expect(result.compiled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exceptionMessage).toContain("NullPointerException");
    expect(result.exceptionStackTrace).toContain("Example.run");
  });

  it("rejects invalid SOAP shapes", () => {
    expect(() => parseSoapExecuteAnonymousResponse("<env:Envelope />")).toThrow(/missing/);
  });
});
