/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, test } from "vitest";
import {
  inferAgentTypeFromTemplate,
  readAgentConfigSliceFromSource,
} from "../lib/agent-user/agent-config.ts";

const BASE_CONFIG = `config:
    agent_name: "Test_Agent"
    description: "Test Agent."
`;

const BASE_REST = `

system:
    instructions: |
        Test

topic main:
    description: "Primary topic."

start_agent main:
    description: "Entry point."
    transition to @topic.main
`;

describe("inferAgentTypeFromTemplate", () => {
  test("maps valid service-agent template to AgentforceServiceAgent", () => {
    expect(inferAgentTypeFromTemplate("SvcCopilotTmpl__AgentforceServiceAgent")).toBe(
      "AgentforceServiceAgent",
    );
  });

  test("maps valid employee-agent template to AgentforceEmployeeAgent", () => {
    expect(inferAgentTypeFromTemplate("SvcCopilotTmpl__AgentforceEmployeeAgent")).toBe(
      "AgentforceEmployeeAgent",
    );
  });

  test("does not guess unknown templates", () => {
    expect(inferAgentTypeFromTemplate("SomeOtherTemplate")).toBeUndefined();
  });
});

describe("readAgentConfigSliceFromSource", () => {
  test("infers Service Agent from agent_template when agent_type is absent", async () => {
    const r = await readAgentConfigSliceFromSource(
      `${BASE_CONFIG}    agent_template: "SvcCopilotTmpl__AgentforceServiceAgent"
    default_agent_user: "agent@example.com"${BASE_REST}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok === false) throw new Error(r.reason_detail);
    expect(r.agent_type).toBe("AgentforceServiceAgent");
    expect(r.agent_type_source).toBe("agent_template");
    expect(r.agent_template).toBe("SvcCopilotTmpl__AgentforceServiceAgent");
    expect(r.default_agent_user).toBe("agent@example.com");
  });

  test("explicit agent_type wins when agent_template is also present", async () => {
    const r = await readAgentConfigSliceFromSource(
      `${BASE_CONFIG}    agent_type: "AgentforceEmployeeAgent"
    agent_template: "SvcCopilotTmpl__AgentforceServiceAgent"${BASE_REST}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok === false) throw new Error(r.reason_detail);
    expect(r.agent_type).toBe("AgentforceEmployeeAgent");
    expect(r.agent_type_source).toBe("explicit");
  });
});
