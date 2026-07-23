/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic public-Pi fixture for SF Herdr event-shape tests. */
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const OUTPUT_PATH_ENV = "SF_HERDR_EVENT_PROBE_OUTPUT";
const TOOL_NAME = "herdr";
const TOOL_INPUT = {
  action: "run",
  command: "sf apex run test --tests ExampleTest",
};

type ProbeRecord = {
  type: "tool_execution_start" | "tool_result" | "tool_execution_end";
  toolName: string;
  args?: unknown;
  input?: unknown;
  hasArgs?: boolean;
  isError?: boolean;
};

export default function runtimeEventProbe(pi: ExtensionAPI): void {
  const outputPath = process.env[OUTPUT_PATH_ENV];
  if (!outputPath) throw new Error(`${OUTPUT_PATH_ENV} is required`);

  const records: ProbeRecord[] = [];
  const record = (entry: ProbeRecord) => {
    records.push(entry);
    writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  };

  const faux = fauxProvider({
    provider: "sf-herdr-event-probe",
    models: [{ id: "probe", name: "SF Herdr Event Probe" }],
  });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall(TOOL_NAME, TOOL_INPUT)], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  pi.registerProvider(faux.provider);

  pi.registerTool({
    name: TOOL_NAME,
    label: "Herdr Probe",
    description: "Deterministic event-shape probe",
    parameters: Type.Object({
      action: Type.String(),
      command: Type.String(),
    }),
    async execute() {
      return {
        content: [{ type: "text", text: "ok" }],
        details: {},
      };
    },
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName !== TOOL_NAME) return;
    record({ type: event.type, toolName: event.toolName, args: event.args });
  });
  pi.on("tool_result", (event) => {
    if (event.toolName !== TOOL_NAME) return;
    record({
      type: event.type,
      toolName: event.toolName,
      input: event.input,
      isError: event.isError,
    });
  });
  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== TOOL_NAME) return;
    record({
      type: event.type,
      toolName: event.toolName,
      hasArgs: "args" in event,
      isError: event.isError,
    });
  });
}
