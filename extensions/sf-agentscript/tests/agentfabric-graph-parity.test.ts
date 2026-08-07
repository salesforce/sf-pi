/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Test-only adoption sentinel for the public AgentFabric graph extractor.
 *
 * The extractor is schema-driven and can enumerate Agentforce nodes, but the
 * current release does not project Agentforce transitions or reasoning-action
 * invocations as edges. Keep this characterization explicit so a future pinned
 * package refresh makes new upstream coverage visible for parity review.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";
import { AgentforceSchemaInfo, parse } from "@sf-agentscript/agentforce";
import { extractGraph } from "@sf-agentscript/agentfabric-dialect";
import { buildQualityFacts } from "../lib/quality/facts.ts";

const HEAD = `system:
  instructions: "Help the user."
  messages:
    welcome: "Hello"
    error: "Error"
config:
  agent_name: "Graph_Parity"
  agent_type: "AgentforceEmployeeAgent"
`;

const CASES = [
  {
    name: "unconditional deterministic transition cycle",
    source: `${HEAD}start_agent main:
  description: "Main"
  before_reasoning:
    transition to @subagent.alpha
subagent alpha:
  description: "Alpha"
  before_reasoning:
    transition to @subagent.beta
subagent beta:
  description: "Beta"
  before_reasoning:
    transition to @subagent.alpha
`,
    expectedNodes: ["start_agent.main", "subagent.alpha", "subagent.beta"],
    expectedLocalEdges: [
      "start_agent.main->subagent.alpha:deterministic_transition",
      "subagent.alpha->subagent.beta:deterministic_transition",
      "subagent.beta->subagent.alpha:deterministic_transition",
    ],
  },
  {
    name: "connected-agent invocation plus planner transition",
    source: `${HEAD}start_agent main:
  description: "Main"
  reasoning:
    actions:
      consult: @connected_subagent.helper
        description: "Ask helper"
      route: @utils.transition to @subagent.next
        description: "Continue"
subagent next:
  description: "Next"
connected_subagent helper:
  target: "agent://Helper"
  description: "Helper"
`,
    expectedNodes: ["connected_subagent.helper", "start_agent.main", "subagent.next"],
    expectedLocalEdges: [
      "start_agent.main->connected_subagent.helper:connected_agent_invocation",
      "start_agent.main->subagent.next:planner_transition",
    ],
  },
  {
    name: "collect routing",
    source: `${HEAD}variables:
  email: mutable string
    description: "Email"
start_agent main:
  description: "Main"
  reasoning:
    actions:
      gather: @utils.transition to @subagent.gather
        description: "Gather details"
subagent gather:
  description: "Gather"
  reasoning:
    instructions: ->
      collect @variables.email
        message: "What is your email?"
`,
    expectedNodes: ["start_agent.main", "subagent.gather"],
    expectedLocalEdges: ["start_agent.main->subagent.gather:planner_transition"],
  },
] as const;

function localEdgeKeys(source: string): string[] {
  const document = parse(source);
  return buildQualityFacts(document.ast)
    .edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind}`)
    .sort();
}

describe("AgentFabric graph parity insight", () => {
  test.each(CASES)("characterizes $name", ({ source, expectedNodes, expectedLocalEdges }) => {
    const document = parse(source);
    // The Agentforce facade re-exports AST classes while AgentFabric types
    // reference the same deduped language package directly. Runtime objects
    // are compatible; bridge the duplicate private-class declarations here.
    const upstream = extractGraph(
      document.ast as unknown as Parameters<typeof extractGraph>[0],
      AgentforceSchemaInfo as unknown as Parameters<typeof extractGraph>[1],
    );

    expect(upstream.nodes.map((node) => node.id).sort()).toEqual([...expectedNodes].sort());
    expect(upstream.edges).toEqual([]);
    expect(localEdgeKeys(source)).toEqual([...expectedLocalEdges].sort());
  });

  test("production Agent Script modules never import the test-only AgentFabric dialect", () => {
    const extensionRoot = path.resolve("extensions/sf-agentscript");
    const importedBy: string[] = [];
    const visit = (dir: string): void => {
      // Dirent metadata avoids a separate stat(path) check before each file read.
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const candidate = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "tests" && entry.name !== "docs") visit(candidate);
        } else if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/.test(candidate)) {
          const source = readFileSync(candidate, "utf8");
          const file = ts.createSourceFile(candidate, source, ts.ScriptTarget.Latest, true);
          const walk = (node: ts.Node): void => {
            let specifier: string | undefined;
            if (
              (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
              node.moduleSpecifier &&
              ts.isStringLiteral(node.moduleSpecifier)
            ) {
              specifier = node.moduleSpecifier.text;
            } else if (
              ts.isImportEqualsDeclaration(node) &&
              ts.isExternalModuleReference(node.moduleReference) &&
              node.moduleReference.expression &&
              ts.isStringLiteral(node.moduleReference.expression)
            ) {
              specifier = node.moduleReference.expression.text;
            } else if (ts.isCallExpression(node)) {
              const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
              const isRequire =
                ts.isIdentifier(node.expression) && node.expression.text === "require";
              const first = node.arguments[0];
              if ((isDynamicImport || isRequire) && first && ts.isStringLiteral(first)) {
                specifier = first.text;
              }
            }
            if (specifier === "@sf-agentscript/agentfabric-dialect") {
              importedBy.push(path.relative(process.cwd(), candidate));
            }
            ts.forEachChild(node, walk);
          };
          walk(file);
        }
      }
    };
    visit(extensionRoot);
    expect(importedBy).toEqual([]);
  });
});
