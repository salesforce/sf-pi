/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Snapshot-style contract tests for Structural Agent Script Inspection.
 *
 * The projection is model-facing: agents rely on the compact component/ref
 * summary shape to plan safe edits. Keep this test focused on output shape;
 * generic AST/reference semantics belong to the official AgentScript packages.
 */

import { parse } from "@sf-agentscript/agentforce";
import { decomposeAtMemberExpression, walkAstExpressions } from "@sf-agentscript/language";
import { describe, expect, test } from "vitest";
import { projectInspectStructure } from "../lib/inspect-structure.ts";

const SOURCE = [
  "system:",
  '    instructions: "You are a support assistant."',
  "",
  "config:",
  '    agent_name: "Snapshot_Bot"',
  '    agent_type: "AgentforceEmployeeAgent"',
  '    description: "snapshot"',
  "",
  "variables:",
  "    VoiceCallId: linked string",
  "        source: @VoiceCall.Id",
  '        visibility: "External"',
  '    customer_name: mutable string = "Acme"',
  "",
  "subagent support:",
  '    description: "Handle support"',
  "    actions:",
  "        classify_issue:",
  '            description: "Classify"',
  '            target: "apex://IssueClassifier"',
  "    reasoning:",
  "        instructions: ->",
  "            | Use @variables.customer_name when known.",
  "",
  "connection service_email:",
  "    response_formats:",
  "        choices:",
  '            source: "response_format://ChoiceFormat"',
  "    reasoning:",
  "        response_actions:",
  "            choices: @response_formats.choices",
  "",
  "modality voice:",
  '    voice_id: "voice-1"',
  "    outbound_speed: 1.0",
  "",
  "start_agent main:",
  '    description: "Entry"',
  "    transition to @subagent.support",
  "",
].join("\n");

describe("projectInspectStructure", () => {
  test("preserves the compact agent-facing component summary shape", () => {
    const doc = parse(SOURCE);
    const result = projectInspectStructure({
      ast: doc.ast,
      dialect: { name: "agentforce" },
      hasParseErrors: false,
      parseErrorCount: 0,
      walkAstExpressions,
      decomposeAtMemberExpression,
    });

    expect({
      components: result.components,
      stats: result.stats,
      has_parse_errors: result.has_parse_errors,
    }).toMatchInlineSnapshot(`
      {
        "components": {
          "actions": [
            {
              "description": "Classify",
              "line": 18,
              "name": "classify_issue",
              "parent": "subagent.support",
              "target": "apex://IssueClassifier",
            },
          ],
          "config": {
            "agent_name": "Snapshot_Bot",
            "agent_type": "AgentforceEmployeeAgent",
            "description": "snapshot",
          },
          "connections": [
            {
              "line": 25,
              "name": "service_email",
              "response_actions": [
                "choices",
              ],
              "response_format_refs": [
                "choices",
              ],
              "response_formats": [
                {
                  "line": 27,
                  "name": "choices",
                  "source": "response_format://ChoiceFormat",
                },
              ],
            },
          ],
          "modalities": [
            {
              "fields": {
                "outbound_speed": 1,
                "voice_id": "voice-1",
              },
              "line": 33,
              "name": "voice",
            },
          ],
          "start_agents": [
            {
              "description": "Entry",
              "line": 37,
              "name": "main",
            },
          ],
          "subagents": [
            {
              "description": "Handle support",
              "line": 15,
              "name": "support",
            },
          ],
          "system": {
            "instructions": "You are a support assistant.",
          },
          "topics": [],
          "variables": [
            {
              "default": undefined,
              "line": 10,
              "linked": true,
              "modifier": "linked",
              "name": "VoiceCallId",
              "source": "@VoiceCall.Id",
              "source_field": "Id",
              "source_namespace": "VoiceCall",
              "type": "string",
              "visibility": "External",
            },
            {
              "default": "Acme",
              "line": 10,
              "modifier": "mutable",
              "mutable": true,
              "name": "customer_name",
              "type": "string",
            },
          ],
        },
        "has_parse_errors": false,
        "stats": {
          "actions": 1,
          "connections": 1,
          "modalities": 1,
          "start_agents": 1,
          "subagents": 1,
          "topics": 0,
          "variables": 2,
        },
      }
    `);
  });
});
