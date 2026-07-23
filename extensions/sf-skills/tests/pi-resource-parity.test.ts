/* SPDX-License-Identifier: Apache-2.0 */
/**
 * E4 — read-only parity evidence against Pi 0.81's public resource resolver.
 *
 * This suite intentionally records disagreements instead of fixing them. ADR
 * 0082 requires a reviewed matrix before any SF Skills production behavior is
 * deleted or changed.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
  loadSkills,
  loadSkillsFromDir,
  type ResolvedResource,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatherCatalogInput } from "../lib/gather.ts";
import { buildSkillCatalog, type CatalogSkill, type SkillCatalog } from "../lib/catalog.ts";
import { planRescopeToProject, planSkillGate, type ScopeOps } from "../lib/resolution.ts";
import {
  detectSkillSources,
  updateSkillSources,
} from "../../../lib/common/skill-sources/skill-sources.ts";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[AGENT_DIR_ENV];
const originalHome = process.env.HOME;
const tempDirs: string[] = [];

type Classification =
  "native-parity" | "salesforce-specific-leverage" | "useful-generic-gap" | "semantic-disagreement";

interface MatrixRow {
  scenario: string;
  capability: string;
  classification: Classification;
  pi: string;
  funnel: string;
  decision: string;
}

interface Fixture {
  root: string;
  home: string;
  agentDir: string;
  cwd: string;
  packageDir: string;
}

interface Observation {
  resolvedSkills: ResolvedResource[];
  loadedSkills: Skill[];
  collisions: Array<{ name: string; winnerPath: string; loserPath: string }>;
  catalog: SkillCatalog;
}

const matrix: MatrixRow[] = [];
let matrixComplete = false;

const EXPECTED_MATRIX: Array<Pick<MatrixRow, "scenario" | "capability" | "classification">> = [
  {
    scenario: "global-load-project-inherit",
    capability: "Effective loading of a global top-level skill in a trusted project",
    classification: "native-parity",
  },
  {
    scenario: "global-load-project-unload",
    capability: "Project top-level subtraction from global top-level settings",
    classification: "native-parity",
  },
  {
    scenario: "global-off-project-load",
    capability: "Trusted project top-level skill loading",
    classification: "native-parity",
  },
  {
    scenario: "package-autoload-false-delta",
    capability: "Project subtraction from a global package",
    classification: "semantic-disagreement",
  },
  {
    scenario: "exact-plus-minus-paths",
    capability: "Exact include/exclude filters",
    classification: "semantic-disagreement",
  },
  {
    scenario: "duplicate-package-pi-agents",
    capability: "Winning precedence for known default-root copies",
    classification: "native-parity",
  },
  {
    scenario: "duplicate-package-pi-agents",
    capability: "Complete collision participant inventory",
    classification: "semantic-disagreement",
  },
  {
    scenario: "trusted-vs-untrusted-project",
    capability: "Project-local resource trust boundary",
    classification: "native-parity",
  },
  {
    scenario: "missing-stale-roots",
    capability: "Missing root omission",
    classification: "native-parity",
  },
  {
    scenario: "missing-stale-roots",
    capability: "Actionable stale wiring diagnostics",
    classification: "salesforce-specific-leverage",
  },
  {
    scenario: "one-skill-global-to-project-rescope",
    capability: "Resulting resolver state after moving one skill",
    classification: "native-parity",
  },
  {
    scenario: "one-skill-global-to-project-rescope",
    capability: "One-action global-to-project rescope workflow",
    classification: "salesforce-specific-leverage",
  },
  {
    scenario: "whole-source-global-to-project-rescope",
    capability: "Whole-source rescope planning",
    classification: "semantic-disagreement",
  },
  {
    scenario: "sf-skills-non-resolver-capabilities",
    capability: "Managed Salesforce skill-pack install/update/unlink",
    classification: "salesforce-specific-leverage",
  },
  {
    scenario: "sf-skills-non-resolver-capabilities",
    capability: "External Claude/Codex/Cursor source discovery",
    classification: "salesforce-specific-leverage",
  },
  {
    scenario: "sf-skills-non-resolver-capabilities",
    capability: "Source Registry labels and stale-source prune guidance",
    classification: "salesforce-specific-leverage",
  },
  {
    scenario: "sf-skills-non-resolver-capabilities",
    capability: "Usage counters and in-context awareness",
    classification: "salesforce-specific-leverage",
  },
];

function record(row: MatrixRow): void {
  matrix.push(row);
}

function makeFixture(prefix: string): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(root);
  const home = path.join(root, "home");
  const agentDir = path.join(home, ".pi", "agent");
  const cwd = path.join(root, "project");
  const packageDir = path.join(root, "fixture-package");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  mkdirSync(path.join(cwd, ".git"), { recursive: true });
  process.env.HOME = home;
  process.env[AGENT_DIR_ENV] = agentDir;
  writeGlobalSettings({});
  writeProjectSettings(cwd, {});
  return { root, home, agentDir, cwd, packageDir };
}

function writeGlobalSettings(settings: Record<string, unknown>): void {
  const agentDir = process.env[AGENT_DIR_ENV];
  if (!agentDir) throw new Error("Missing isolated Pi agent dir");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

function writeProjectSettings(cwd: string, settings: Record<string, unknown>): void {
  const configDir = path.join(cwd, ".pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

function readSettings(file: string): { skills?: string[] } {
  return JSON.parse(readFileSync(file, "utf8")) as { skills?: string[] };
}

function writeSkill(root: string, name: string, marker = name): string {
  const skillDir = path.join(root, name);
  mkdirSync(skillDir, { recursive: true });
  const file = path.join(skillDir, "SKILL.md");
  writeFileSync(
    file,
    `---\nname: ${name}\ndescription: ${marker} fixture skill\n---\n\n# ${marker}\n`,
  );
  return file;
}

function writePackage(fixture: Fixture, names: string[]): Record<string, string> {
  const skillsRoot = path.join(fixture.packageDir, "skills");
  const files = Object.fromEntries(
    names.map((name) => [name, writeSkill(skillsRoot, name, `package-${name}`)]),
  );
  writeFileSync(
    path.join(fixture.packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "pi-resource-parity-fixture",
        version: "1.0.0",
        pi: { skills: ["./skills"] },
      },
      null,
      2,
    )}\n`,
  );
  return files;
}

async function observe(fixture: Fixture, projectTrusted = true): Promise<Observation> {
  const settingsManager = SettingsManager.create(fixture.cwd, fixture.agentDir, {
    projectTrusted,
  });
  const packageManager = new DefaultPackageManager({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    settingsManager,
  });
  const resolved = await packageManager.resolve(async () => "skip");
  const loader = new DefaultResourceLoader({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getSkills();
  const collisions = loaded.diagnostics.flatMap((diagnostic) =>
    diagnostic.type === "collision" && diagnostic.collision
      ? [
          {
            name: diagnostic.collision.name,
            winnerPath: diagnostic.collision.winnerPath,
            loserPath: diagnostic.collision.loserPath,
          },
        ]
      : [],
  );

  // Production gather reads Pi's registered skill commands for exact loaded
  // paths. The public ResourceLoader does not register session commands, so E4
  // adapts its real loaded Skill objects into the same canonical provenance
  // shape. This does not claim slash-command registration coverage.
  const commands = loaded.skills.map((skill) => ({
    name: `skill:${skill.name}`,
    description: skill.description,
    source: "skill" as const,
    sourceInfo: skill.sourceInfo,
  }));
  const input = gatherCatalogInput({
    cwd: fixture.cwd,
    projectTrusted,
    deps: {
      loadSkills,
      loadSkillsFromDir,
      getCommands: () => commands,
      home: fixture.home,
      agentDir: fixture.agentDir,
      loadUsage: () => new Map(),
    },
  });

  return {
    resolvedSkills: resolved.skills,
    loadedSkills: loaded.skills,
    collisions,
    catalog: buildSkillCatalog(input),
  };
}

function loadedSkillNames(observation: Observation): string[] {
  return observation.loadedSkills.map((skill) => skill.name).sort();
}

function catalogRows(observation: Observation, name: string): CatalogSkill[] {
  return observation.catalog.skills.filter((skill) => skill.name === name);
}

function resolvedByPath(observation: Observation, filePath: string): ResolvedResource | undefined {
  return observation.resolvedSkills.find((skill) => skill.path === filePath);
}

function applyOps(fixture: Fixture, ops: ScopeOps[]): void {
  for (const op of ops) {
    updateSkillSources({
      add: op.add,
      remove: op.remove,
      scope: op.scope,
      cwd: fixture.cwd,
      home: fixture.home,
      settingsFile:
        op.scope === "global"
          ? path.join(fixture.agentDir, "settings.json")
          : path.join(fixture.cwd, ".pi", "settings.json"),
    });
  }
}

function restoreEnvironment(): void {
  if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
  else process.env[AGENT_DIR_ENV] = originalAgentDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  restoreEnvironment();
});

afterAll(() => {
  const reportPath = process.env.SF_PI_E4_REPORT_PATH;
  if (!reportPath || !matrixComplete) return;
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        milestone: "E4",
        runtimeContract: ">=0.81.1 <0.82.0",
        productionBehaviorChanged: false,
        deletionAuthorized: false,
        matrix,
      },
      null,
      2,
    )}\n`,
  );
});

describe.sequential("E4 Pi resource resolution parity", () => {
  it("matches global top-level loading inherited by a project", async () => {
    const fixture = makeFixture("sf-skills-e4-global-");
    const root = path.join(fixture.home, "external", "skills");
    writeSkill(root, "alpha");
    writeGlobalSettings({ skills: [root] });

    const observation = await observe(fixture);
    expect(loadedSkillNames(observation)).toEqual(["alpha"]);
    expect(catalogRows(observation, "alpha")[0]).toMatchObject({
      enabledGlobal: true,
      enabledProject: false,
      effective: "loaded",
    });
    record({
      scenario: "global-load-project-inherit",
      capability: "Effective loading of a global top-level skill in a trusted project",
      classification: "native-parity",
      pi: "Loads alpha from user-scoped top-level settings.",
      funnel: "Tags alpha enabledGlobal and loaded.",
      decision: "Deletion candidate only; E4 authorizes no deletion.",
    });
  });

  it("confirms project top-level exclusions alone do not subtract global skills", async () => {
    const fixture = makeFixture("sf-skills-e4-project-unload-");
    const root = path.join(fixture.home, "external", "skills");
    const alpha = writeSkill(root, "alpha");
    writeGlobalSettings({ skills: [root] });
    writeProjectSettings(fixture.cwd, { skills: [`-${alpha}`] });

    const observation = await observe(fixture);
    expect(loadedSkillNames(observation)).toEqual(["alpha"]);
    const row = catalogRows(observation, "alpha")[0];
    expect(
      planSkillGate({
        skill: row,
        enable: false,
        scope: "project",
        cwd: fixture.cwd,
        home: fixture.home,
      }).blocked,
    ).toBe("locked-by-global");
    record({
      scenario: "global-load-project-unload",
      capability: "Project top-level subtraction from global top-level settings",
      classification: "native-parity",
      pi: "A project-only -path has no source set to subtract, so alpha remains loaded.",
      funnel: "Blocks project disable as locked-by-global.",
      decision: "Retain the additive-scope rule for top-level settings pending broader decisions.",
    });
  });

  it("matches trusted project loading when global scope is off", async () => {
    const fixture = makeFixture("sf-skills-e4-project-load-");
    const root = path.join(fixture.root, "project-external", "skills");
    const alpha = writeSkill(root, "alpha");
    writeProjectSettings(fixture.cwd, { skills: [alpha] });

    const observation = await observe(fixture);
    expect(loadedSkillNames(observation)).toEqual(["alpha"]);
    expect(resolvedByPath(observation, alpha)?.metadata.scope).toBe("project");
    expect(catalogRows(observation, "alpha")[0]).toMatchObject({
      enabledGlobal: false,
      enabledProject: true,
      effective: "loaded",
    });
    record({
      scenario: "global-off-project-load",
      capability: "Trusted project top-level skill loading",
      classification: "native-parity",
      pi: "Loads alpha with project provenance.",
      funnel: "Tags alpha enabledProject and loaded.",
      decision: "Deletion candidate only; keep Funnel governance until later authorization.",
    });
  });

  it("records Pi package autoload:false subtraction that the Funnel does not model", async () => {
    const fixture = makeFixture("sf-skills-e4-package-delta-");
    const files = writePackage(fixture, ["alpha", "beta"]);
    writeGlobalSettings({ packages: [fixture.packageDir] });
    writeProjectSettings(fixture.cwd, {
      packages: [
        {
          source: fixture.packageDir,
          autoload: false,
          skills: ["-skills/beta/SKILL.md"],
        },
      ],
    });

    const observation = await observe(fixture);
    expect(loadedSkillNames(observation)).toEqual(["alpha"]);
    expect(resolvedByPath(observation, files.alpha)?.enabled).toBe(true);
    expect(resolvedByPath(observation, files.beta)?.enabled).toBe(false);
    expect(observation.catalog.skills).toEqual([]);
    record({
      scenario: "package-autoload-false-delta",
      capability: "Project subtraction from a global package",
      classification: "semantic-disagreement",
      pi: "Project autoload:false delta disables beta while alpha remains globally enabled.",
      funnel: "Current gather/catalog does not model package resources or package deltas.",
      decision:
        "Return for a later product decision; do not delete or change Funnel behavior in E4.",
    });
  });

  it("records exact package and top-level +path/-path filter semantics", async () => {
    const packageFixture = makeFixture("sf-skills-e4-package-filter-");
    const packageFiles = writePackage(packageFixture, ["alpha", "beta"]);
    writeGlobalSettings({
      packages: [
        {
          source: packageFixture.packageDir,
          skills: ["!skills/**", "+skills/alpha/SKILL.md", "-skills/beta/SKILL.md"],
        },
      ],
    });
    const packageObservation = await observe(packageFixture);
    expect(resolvedByPath(packageObservation, packageFiles.alpha)?.enabled).toBe(true);
    expect(resolvedByPath(packageObservation, packageFiles.beta)?.enabled).toBe(false);
    expect(loadedSkillNames(packageObservation)).toEqual(["alpha"]);

    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    restoreEnvironment();

    const topLevelFixture = makeFixture("sf-skills-e4-top-filter-");
    const root = path.join(topLevelFixture.home, "external", "skills");
    const alpha = writeSkill(root, "alpha");
    const beta = writeSkill(root, "beta");
    writeGlobalSettings({ skills: [root, "!**", `+${alpha}`, `-${beta}`] });
    const topLevelObservation = await observe(topLevelFixture);
    expect(resolvedByPath(topLevelObservation, alpha)?.enabled).toBe(true);
    expect(resolvedByPath(topLevelObservation, beta)?.enabled).toBe(false);
    expect(loadedSkillNames(topLevelObservation)).toEqual(["alpha"]);
    expect(catalogRows(topLevelObservation, "beta")[0]?.effective).toBe("loaded");

    record({
      scenario: "exact-plus-minus-paths",
      capability: "Exact include/exclude filters",
      classification: "semantic-disagreement",
      pi: "Public resolver honors exact +path/-path for package and top-level resource sets.",
      funnel:
        "Package resources are absent and top-level filter tokens are treated as paths, so beta is misclassified loaded.",
      decision:
        "Return filter-aware governance semantics for explicit design; no E4 production change.",
    });
  });

  it("records complete duplicate precedence across package, .pi, and .agents roots", async () => {
    const fixture = makeFixture("sf-skills-e4-duplicates-");
    const packageFile = writePackage(fixture, ["duplicate"]).duplicate;
    const piFile = writeSkill(path.join(fixture.cwd, ".pi", "skills"), "duplicate", "pi-project");
    const agentsFile = writeSkill(
      path.join(fixture.cwd, ".agents", "skills"),
      "duplicate",
      "agents-project",
    );
    writeGlobalSettings({ packages: [fixture.packageDir] });

    const observation = await observe(fixture);
    expect(observation.loadedSkills.find((skill) => skill.name === "duplicate")?.filePath).toBe(
      piFile,
    );
    expect(observation.collisions.map((collision) => collision.loserPath)).toEqual([
      agentsFile,
      packageFile,
    ]);
    const funnelRows = catalogRows(observation, "duplicate");
    expect(funnelRows.some((row) => row.filePath === piFile && row.conflictRole === "winner")).toBe(
      true,
    );
    expect(funnelRows.some((row) => row.filePath === agentsFile)).toBe(true);
    expect(funnelRows.some((row) => row.filePath === packageFile)).toBe(false);
    record({
      scenario: "duplicate-package-pi-agents",
      capability: "Winning precedence for known default-root copies",
      classification: "native-parity",
      pi: "Project .pi copy wins ahead of project .agents and package copies.",
      funnel: "Marks the .pi copy as the report-only winner over the .agents copy.",
      decision:
        "Winner precedence is a deletion candidate only after complete inventory is resolved.",
    });
    record({
      scenario: "duplicate-package-pi-agents",
      capability: "Complete collision participant inventory",
      classification: "semantic-disagreement",
      pi: "Reports .agents and package copies as separate collision losers.",
      funnel: "Omits the package participant from its catalog.",
      decision: "Return for a later package-resource governance decision.",
    });
  });

  it("matches Pi project trust gating", async () => {
    const fixture = makeFixture("sf-skills-e4-trust-");
    const globalRoot = path.join(fixture.home, "external", "skills");
    writeSkill(globalRoot, "global-skill");
    writeSkill(path.join(fixture.cwd, ".pi", "skills"), "pi-project");
    writeSkill(path.join(fixture.cwd, ".agents", "skills"), "agents-project");
    writeGlobalSettings({ skills: [globalRoot] });

    const trusted = await observe(fixture, true);
    const untrusted = await observe(fixture, false);
    expect(loadedSkillNames(trusted)).toEqual(["agents-project", "global-skill", "pi-project"]);
    expect(loadedSkillNames(untrusted)).toEqual(["global-skill"]);
    expect(trusted.catalog.skills.map((skill) => skill.name).sort()).toEqual([
      "agents-project",
      "global-skill",
      "pi-project",
    ]);
    expect(untrusted.catalog.skills.map((skill) => skill.name)).toEqual(["global-skill"]);
    record({
      scenario: "trusted-vs-untrusted-project",
      capability: "Project-local resource trust boundary",
      classification: "native-parity",
      pi: "Trusted loads .pi/.agents project skills; untrusted retains only global skills.",
      funnel: "Trusted/untrusted catalogs expose the same boundary.",
      decision: "Native trust gating is a deletion candidate; Funnel explanation remains useful.",
    });
  });

  it("retains SF Skills stale-root diagnostics while matching Pi omission", async () => {
    const fixture = makeFixture("sf-skills-e4-stale-");
    const missing = path.join(fixture.home, "missing", "skills");
    writeGlobalSettings({ skills: [missing] });

    const observation = await observe(fixture);
    const detected = detectSkillSources({ home: fixture.home, cwd: fixture.cwd });
    expect(observation.resolvedSkills).toEqual([]);
    expect(observation.loadedSkills).toEqual([]);
    expect(observation.catalog.skills).toEqual([]);
    expect(detected.staleWired).toContain(missing);
    record({
      scenario: "missing-stale-roots",
      capability: "Missing root omission",
      classification: "native-parity",
      pi: "Silently omits the missing top-level skill root.",
      funnel: "Does not claim any skill loaded from the missing root.",
      decision: "No loader behavior change.",
    });
    record({
      scenario: "missing-stale-roots",
      capability: "Actionable stale wiring diagnostics",
      classification: "salesforce-specific-leverage",
      pi: "Public resolver returns no resolved resource or actionable diagnostic for this stale root.",
      funnel: "Source detection identifies the stale settings entry for prune/reporting flows.",
      decision: "Retain SF Skills diagnostics and prune behavior.",
    });
  });

  it("proves one-skill global-to-project rescope and retains the convenience", async () => {
    const fixture = makeFixture("sf-skills-e4-one-rescope-");
    const root = path.join(fixture.home, "external", "skills");
    const alpha = writeSkill(root, "alpha");
    const beta = writeSkill(root, "beta");
    writeGlobalSettings({ skills: [root] });
    const before = await observe(fixture);
    const alphaRow = catalogRows(before, "alpha")[0];
    const plan = planRescopeToProject({ skills: [alphaRow], cwd: fixture.cwd, home: fixture.home });
    applyOps(fixture, plan.ops);

    const after = await observe(fixture);
    expect(loadedSkillNames(after)).toEqual(["alpha", "beta"]);
    expect(resolvedByPath(after, alpha)?.metadata.scope).toBe("project");
    expect(resolvedByPath(after, beta)?.metadata.scope).toBe("user");
    expect(catalogRows(after, "alpha")[0]).toMatchObject({
      enabledGlobal: false,
      enabledProject: true,
    });
    record({
      scenario: "one-skill-global-to-project-rescope",
      capability: "Resulting resolver state after moving one skill",
      classification: "native-parity",
      pi: "Loads alpha from project scope and beta from global scope.",
      funnel: "Reports the same scope split after applying its native settings plan.",
      decision: "Result semantics are native; no deletion is authorized by E4.",
    });
    record({
      scenario: "one-skill-global-to-project-rescope",
      capability: "One-action global-to-project rescope workflow",
      classification: "salesforce-specific-leverage",
      pi: "Public resolver consumes settings but exposes no rescope operation.",
      funnel: "Plans and applies the explicit move with user-visible scope semantics.",
      decision: "Retain the rescope convenience.",
    });
  });

  it("records the current whole-source rescope disagreement without fixing it", async () => {
    const fixture = makeFixture("sf-skills-e4-whole-rescope-");
    const root = path.join(fixture.home, "external", "skills");
    const alpha = writeSkill(root, "alpha");
    const beta = writeSkill(root, "beta");
    writeGlobalSettings({ skills: [root] });
    const before = await observe(fixture);
    const rows = before.catalog.skills.filter((skill) => skill.enabledGlobal);
    const plan = planRescopeToProject({ skills: rows, cwd: fixture.cwd, home: fixture.home });
    applyOps(fixture, plan.ops);

    const global = readSettings(path.join(fixture.agentDir, "settings.json")).skills ?? [];
    const project = readSettings(path.join(fixture.cwd, ".pi", "settings.json")).skills ?? [];
    expect(new Set(global)).toEqual(new Set([alpha, beta]));
    expect(new Set(project)).toEqual(new Set([alpha, beta]));
    const after = await observe(fixture);
    expect(catalogRows(after, "alpha")[0]).toMatchObject({
      enabledGlobal: true,
      enabledProject: true,
    });
    expect(catalogRows(after, "beta")[0]).toMatchObject({
      enabledGlobal: true,
      enabledProject: true,
    });
    record({
      scenario: "whole-source-global-to-project-rescope",
      capability: "Whole-source rescope planning",
      classification: "semantic-disagreement",
      pi: "Consumes the emitted settings, which still wire both skills globally and project-locally.",
      funnel:
        "Independent expand-minus-one plans re-add each sibling, so the source is not removed globally.",
      decision:
        "Current defect requires a separately authorized fix; E4 changes no production behavior.",
    });
  });

  it("classifies non-resolver SF Skills capabilities independently", () => {
    const capabilities = [
      "Managed Salesforce skill-pack install/update/unlink",
      "External Claude/Codex/Cursor source discovery",
      "Source Registry labels and stale-source prune guidance",
      "Usage counters and in-context awareness",
    ];
    for (const capability of capabilities) {
      record({
        scenario: "sf-skills-non-resolver-capabilities",
        capability,
        classification: "salesforce-specific-leverage",
        pi: "No equivalent operation is exposed by the E4 public resolver evidence seams.",
        funnel: "Provides Salesforce-oriented governance or observability beyond resource loading.",
        decision: "Retain unless a future separately reviewed proof supersedes it.",
      });
    }
    expect(capabilities).toHaveLength(4);
  });

  it("produces the exact reviewed decision matrix without authorizing deletion", () => {
    expect(
      matrix.map(({ scenario, capability, classification }) => ({
        scenario,
        capability,
        classification,
      })),
    ).toEqual(EXPECTED_MATRIX);
    expect(matrix).toHaveLength(EXPECTED_MATRIX.length);
    expect(matrix.every((row) => row.decision.length > 0)).toBe(true);
    matrixComplete = true;
  });
});
