#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate sweep-owned Flow/Apex stubs for Agent Script action targets.
 *
 * This is a validation helper, not production metadata generation. It reads
 * `.agent` files, extracts `target:` action declarations plus simple
 * input/output names, then writes a small SFDX project containing:
 *
 * - active autolaunched Flow stubs for `flow://Name`
 * - invocable Apex class stubs for `apex://ClassName`
 *
 * Unsupported targets (standardInvocableAction, placeholder, externalService,
 * apex://Class.method, record-id-like names) are reported and skipped. Deploy
 * the generated project to a disposable validation org before attempting full
 * lifecycle sweeps.
 *
 * Usage:
 *   node scripts/agentscript-generate-stubs.mjs --agent-file path/to/X.agent --output-dir /tmp/stubs
 *   node scripts/agentscript-generate-stubs.mjs --agent-dir /tmp/agents --output-dir /tmp/stubs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inspect as nodeInspect } from "node:util";

function parseArgs(argv) {
  const out = { agentFiles: [], apiVersion: "64.0" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent-file" && argv[i + 1]) out.agentFiles.push(argv[++i]);
    else if (arg.startsWith("--agent-file="))
      out.agentFiles.push(arg.slice("--agent-file=".length));
    else if (arg === "--agent-dir" && argv[i + 1]) out.agentDir = argv[++i];
    else if (arg.startsWith("--agent-dir=")) out.agentDir = arg.slice("--agent-dir=".length);
    else if (arg === "--output-dir" && argv[i + 1]) out.outputDir = argv[++i];
    else if (arg.startsWith("--output-dir=")) out.outputDir = arg.slice("--output-dir=".length);
    else if (arg === "--api-version" && argv[i + 1]) out.apiVersion = argv[++i];
    else if (arg.startsWith("--api-version=")) out.apiVersion = arg.slice("--api-version=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage: node scripts/agentscript-generate-stubs.mjs --output-dir <dir> [--agent-file X.agent ... | --agent-dir dir]",
    "",
    "Options:",
    "  --agent-file <file>   Agent Script file to scan. Repeatable.",
    "  --agent-dir <dir>     Directory tree to scan for .agent files.",
    "  --output-dir <dir>    Output SFDX project directory.",
    "  --api-version <ver>   Metadata API version for stubs. Default 64.0.",
  ].join("\n");
}

function findAgentFiles(dir) {
  const stdout = execFileSync("find", [dir, "-name", "*.agent"], { encoding: "utf8" });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function countIndent(raw) {
  return raw.length - raw.trimStart().length;
}

function entryName(trimmed) {
  const match = /^(?<name>[A-Za-z_][\w-]*)\s*:\s*(?:#.*)?$/.exec(trimmed);
  return match?.groups?.name;
}

function scalarAfterColon(trimmed) {
  const idx = trimmed.indexOf(":");
  if (idx < 0) return undefined;
  return trimmed
    .slice(idx + 1)
    .trim()
    .replace(/^"|"$/g, "");
}

function parseTarget(trimmed) {
  if (!trimmed.startsWith("target:")) return undefined;
  const raw = scalarAfterColon(trimmed);
  const match = /^([A-Za-z][\w-]*):\/\/(.+)$/.exec(raw ?? "");
  if (!match) return undefined;
  return { uri: raw, scheme: match[1], ref: match[2] };
}

function parseAgentActions(source) {
  const lines = source.split("\n").map((raw, line) => ({
    raw,
    line,
    trimmed: raw.trim(),
    indent: countIndent(raw),
  }));
  const actions = [];
  for (let i = 0; i < lines.length; i++) {
    const target = parseTarget(lines[i].trimmed);
    if (!target) continue;
    let start;
    for (let j = i - 1; j >= 0; j--) {
      if (!lines[j].trimmed || lines[j].trimmed.startsWith("#")) continue;
      if (lines[j].indent >= lines[i].indent) continue;
      const name = entryName(lines[j].trimmed);
      if (name) {
        start = lines[j];
        break;
      }
    }
    if (!start) continue;
    const block = [];
    for (const line of lines.slice(start.line + 1)) {
      if (line.trimmed && line.indent <= start.indent) break;
      block.push(line);
    }
    actions.push({
      name: entryName(start.trimmed),
      target,
      inputs: parseIo(block, "inputs"),
      outputs: parseIo(block, "outputs"),
    });
  }
  return actions;
}

const ACTION_PARAM_METADATA_FIELDS = new Set([
  "label",
  "description",
  "is_required",
  "is_user_input",
  "is_displayable",
  "filter_from_agent",
  "require_user_confirmation",
  "include_in_progress_indicator",
  "complex_data_type_name",
  "schema",
]);

function parseIo(block, sectionName) {
  const out = [];
  for (let i = 0; i < block.length; i++) {
    if (!new RegExp(`^${sectionName}\\s*:`).test(block[i].trimmed)) continue;
    const sectionIndent = block[i].indent;
    for (const line of block.slice(i + 1)) {
      if (line.trimmed && line.indent <= sectionIndent) break;
      const match = /^([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*(?:\[[^\]]+\])?)/.exec(line.trimmed);
      if (match && !ACTION_PARAM_METADATA_FIELDS.has(match[1])) {
        out.push({ name: match[1], type: match[2] });
      }
    }
  }
  return out;
}

function safeName(name) {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}

function looksLikeSalesforceId(name) {
  return /^(?:00D|005|001|003|500|301|300|01p|0X9|0Xx|0Mw|0Af)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(
    name,
  );
}

function flowType(type) {
  if (["boolean"].includes(type)) return { dataType: "Boolean" };
  if (["number", "integer", "long"].includes(type)) return { dataType: "Number", scale: 2 };
  return { dataType: "String" };
}

function mergeIo(target, source) {
  const byName = new Map(target.map((item) => [item.name, item]));
  for (const item of source) {
    if (!byName.has(item.name)) {
      target.push(item);
      byName.set(item.name, item);
    }
  }
}

function apexType(type) {
  if (type === "boolean") return "Boolean";
  if (["number", "integer", "long"].includes(type)) return "Decimal";
  return "String";
}

function flowXml(name, action, apiVersion) {
  const variables = new Map();
  variables.set("dummyText", { type: "string", input: false, output: false });
  for (const input of action.inputs)
    variables.set(input.name, { type: input.type, input: true, output: false });
  for (const output of action.outputs)
    variables.set(output.name, { type: output.type, input: false, output: true });
  const varXml = [...variables.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([varName, meta]) => {
      const type = flowType(meta.type);
      return [
        "    <variables>",
        `        <name>${varName}</name>`,
        `        <dataType>${type.dataType}</dataType>`,
        type.scale !== undefined ? `        <scale>${type.scale}</scale>` : undefined,
        "        <isCollection>false</isCollection>",
        `        <isInput>${String(meta.input)}</isInput>`,
        `        <isOutput>${String(meta.output)}</isOutput>`,
        "    </variables>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${apiVersion}</apiVersion>
    <assignments>
        <name>NoOp</name>
        <label>No Op</label>
        <locationX>176</locationX>
        <locationY>134</locationY>
        <assignmentItems>
            <assignToReference>dummyText</assignToReference>
            <operator>Assign</operator>
            <value><stringValue>ok</stringValue></value>
        </assignmentItems>
    </assignments>
    <interviewLabel>${name} {!$Flow.CurrentDateTime}</interviewLabel>
    <label>${name}</label>
    <processType>AutoLaunchedFlow</processType>
    <start><locationX>50</locationX><locationY>0</locationY><connector><targetReference>NoOp</targetReference></connector></start>
    <status>Active</status>
${varXml}
</Flow>
`;
}

function apexClass(name, action) {
  const requestFields = action.inputs
    .map((input) => `    @InvocableVariable public ${apexType(input.type)} ${input.name};`)
    .join("\n");
  const responseFields = action.outputs
    .map((output) => `    @InvocableVariable public ${apexType(output.type)} ${output.name};`)
    .join("\n");
  const defaults = action.outputs
    .map((output) => {
      const type = apexType(output.type);
      const value = type === "Boolean" ? "true" : type === "Decimal" ? "0" : "'stub'";
      return `      response.${output.name} = ${value};`;
    })
    .join("\n");
  return `public with sharing class ${name} {
  public class Request {
${requestFields || "    @InvocableVariable public String inputValue;"}
  }
  public class Response {
${responseFields || "    @InvocableVariable public String result;"}
  }
  @InvocableMethod(label='${name}')
  public static List<Response> run(List<Request> requests) {
    List<Response> results = new List<Response>();
    for (Request request : requests) {
      Response response = new Response();
${defaults || "      response.result = 'stub';"}
      results.add(response);
    }
    return results;
  }
}
`;
}

function apexMeta(apiVersion) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${apiVersion}</apiVersion>
    <status>Active</status>
</ApexClass>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.outputDir) throw new Error("--output-dir is required");
  let files = args.agentFiles.map((file) => path.resolve(file));
  if (args.agentDir) files = [...files, ...findAgentFiles(path.resolve(args.agentDir))];
  if (files.length === 0) throw new Error("Pass --agent-file or --agent-dir");

  const outputDir = path.resolve(args.outputDir);
  const flowDir = path.join(outputDir, "force-app/main/default/flows");
  const classDir = path.join(outputDir, "force-app/main/default/classes");
  mkdirSync(flowDir, { recursive: true });
  mkdirSync(classDir, { recursive: true });
  writeFileSync(
    path.join(outputDir, "sfdx-project.json"),
    `${JSON.stringify({ packageDirectories: [{ path: "force-app", default: true }], name: "agentscript-stubs", sourceApiVersion: args.apiVersion }, null, 2)}\n`,
  );

  const summary = {
    output_dir: outputDir,
    agent_files: files.length,
    flows: [],
    apex: [],
    skipped: [],
  };
  const byTarget = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const action of parseAgentActions(source)) {
      const key = `${action.target.scheme}://${action.target.ref}`;
      const existing = byTarget.get(key);
      if (existing) {
        mergeIo(existing.inputs, action.inputs);
        mergeIo(existing.outputs, action.outputs);
      } else {
        byTarget.set(key, { ...action, inputs: [...action.inputs], outputs: [...action.outputs] });
      }
    }
  }

  for (const [key, action] of byTarget) {
    if (looksLikeSalesforceId(action.target.ref)) {
      summary.skipped.push({ target: key, reason: "looks_like_salesforce_id" });
      continue;
    }
    if (!safeName(action.target.ref)) {
      summary.skipped.push({ target: key, reason: "unsupported_ref_name" });
      continue;
    }
    if (action.target.scheme === "flow") {
      writeFileSync(
        path.join(flowDir, `${action.target.ref}.flow-meta.xml`),
        flowXml(action.target.ref, action, args.apiVersion),
      );
      summary.flows.push(action.target.ref);
    } else if (action.target.scheme === "apex") {
      writeFileSync(
        path.join(classDir, `${action.target.ref}.cls`),
        apexClass(action.target.ref, action),
      );
      writeFileSync(
        path.join(classDir, `${action.target.ref}.cls-meta.xml`),
        apexMeta(args.apiVersion),
      );
      summary.apex.push(action.target.ref);
    } else {
      summary.skipped.push({ target: key, reason: "unsupported_scheme" });
    }
  }
  writeFileSync(path.join(outputDir, "stub-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : nodeInspect(err, { depth: 5 }));
  process.exit(1);
});
