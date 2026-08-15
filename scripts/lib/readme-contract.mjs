/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Factual extension README contract.
 *
 * READMEs are human behavior/usage pages. This validator enforces only the
 * conditional routing sections whose presence can be derived from a manifest;
 * it deliberately does not prescribe feature-specific narrative headings.
 */

const CONDITIONAL_SECTIONS = [
  "What It Does",
  "Commands",
  "Configuration",
  "Safety and Data Boundaries",
  "References",
  "Troubleshooting",
  "File Structure",
];

const CANONICAL_BY_LOWER = new Map(
  CONDITIONAL_SECTIONS.map((heading) => [heading.toLowerCase(), heading]),
);

const SECTION_ALIASES = new Map([
  ["command", "Commands"],
  ["command surface", "Commands"],
  ["commands & controls", "Commands"],
  ["slash commands", "Commands"],
  ["settings", "Configuration"],
  ["settings panel", "Configuration"],
  ["color preferences", "Configuration"],
  ["preferences", "Configuration"],
  ["config layers", "Configuration"],
  ["lifecycle settings", "Configuration"],
  ["settings and safety", "Configuration and Safety and Data Boundaries"],
  ["safety", "Safety and Data Boundaries"],
  ["safety model", "Safety and Data Boundaries"],
  ["security", "Safety and Data Boundaries"],
  ["architecture references", "References"],
]);

const EDITOR_ONLY_HEADINGS = [
  /^architecture$/i,
  /^async architecture$/i,
  /^design rationale$/i,
  /^key architecture(?: decisions|:.*)?$/i,
  /^memory management$/i,
  /^pi sdk features used(?:\s*\(\d+\))?$/i,
  /^release checks$/i,
  /^release hardening harness$/i,
  /^section guide$/i,
  /^type-safety best practices used$/i,
];

export function validateExtensionReadmeContract(source, manifest) {
  const findings = [];
  const sections = parseH2Sections(source);
  const byName = new Map();

  for (const section of sections) {
    const normalized = section.heading.toLowerCase();
    const existing = byName.get(normalized) ?? [];
    existing.push(section);
    byName.set(normalized, existing);

    const canonical = SECTION_ALIASES.get(normalized) ?? CANONICAL_BY_LOWER.get(normalized);
    if (canonical && canonical !== section.heading) {
      findings.push(`Rename "## ${section.heading}" to canonical section "## ${canonical}".`);
    }
    if (EDITOR_ONLY_HEADINGS.some((pattern) => pattern.test(section.heading))) {
      findings.push(
        `Move editor-only "## ${section.heading}" content to AGENTS.md, source comments, Behavior Proofs, or an ADR.`,
      );
    }
  }

  for (const occurrences of byName.values()) {
    if (occurrences.length > 1)
      findings.push(`Duplicate README section: ## ${occurrences[0].heading}.`);
  }

  const required = ["What It Does", "File Structure"];
  if ((manifest.commands?.length ?? 0) > 0) required.push("Commands");
  if (manifest.configurable || (manifest.docs?.env?.length ?? 0) > 0) {
    required.push("Configuration");
  }
  if ((manifest.docs?.safety?.length ?? 0) > 0) required.push("Safety and Data Boundaries");
  if ((manifest.docs?.referenceRoots?.length ?? 0) > 0) required.push("References");

  for (const heading of required) {
    if (!byName.has(heading.toLowerCase()))
      findings.push(`Missing required section: ## ${heading}.`);
  }

  const presentStandardSections = CONDITIONAL_SECTIONS.map((heading) => ({
    heading,
    section: byName.get(heading.toLowerCase())?.[0],
  })).filter((entry) => entry.section);
  for (let index = 1; index < presentStandardSections.length; index++) {
    if (
      presentStandardSections[index - 1].section.start >
      presentStandardSections[index].section.start
    ) {
      findings.push(
        `Canonical sections are out of order: ## ${presentStandardSections[index - 1].heading} must precede ## ${presentStandardSections[index].heading}.`,
      );
    }
  }

  for (const { heading, section } of presentStandardSections) {
    const meaningful = section.body
      .replace(/<!--[^]*?-->/g, "")
      .replace(/```[^]*?```/g, (block) => block.replace(/```\w*/g, "").trim())
      .trim();
    if (meaningful.length === 0) findings.push(`Conditional section ## ${heading} is empty.`);
  }

  const fileStructure = byName.get("file structure")?.[0];
  if (fileStructure && sections.at(-1) !== fileStructure) {
    findings.push("## File Structure must be the final H2 section.");
  }
  if (/\bTODO\b/.test(source)) findings.push("README contains unresolved TODO placeholder text.");
  if (/read (?:this|the )?(?:document|readme(?:\.md)?) before (?:making )?changes/i.test(source)) {
    findings.push("README must not be a mandatory code-edit prerequisite; use AGENTS.md instead.");
  }

  return findings;
}

function parseH2Sections(source) {
  const matches = [...source.matchAll(/^##\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    return {
      heading: match[1].trim(),
      start,
      body: source.slice(bodyStart, end),
    };
  });
}
