/* SPDX-License-Identifier: Apache-2.0 */
/** Shared types for sf-pi doctor diagnostics and non-destructive repairs. */

export type DoctorSeverity = "ok" | "info" | "warn" | "error";

export interface DoctorIssue {
  id: string;
  severity: DoctorSeverity;
  title: string;
  detail: string;
  fix?: string;
}

export interface SkillLocation {
  name: string;
  file: string;
  root: string;
  rootLabel: string;
  rootKind: SkillRootKind;
  settingsValue?: string;
}

export type SkillRootKind =
  | "pi"
  | "agents"
  | "claude"
  | "codex"
  | "cursor"
  | "project-pi"
  | "project-agents"
  | "settings";

export interface SkillCollision {
  name: string;
  locations: SkillLocation[];
  preferred: SkillLocation;
  duplicates: SkillLocation[];
}

export interface StaleSkillPath {
  raw: string;
  resolved: string;
}

export interface AvailableSkillRoot {
  label: string;
  settingsPath: string;
  absolutePath: string;
  skillCount: number;
}

export interface SfPiPackageDuplicate {
  settingsPath: string;
  entries: string[];
}

export interface RuntimeDiagnostics {
  piVersion?: string;
  requiredPiVersion: string;
  nodeVersion: string;
  nodePath?: string;
  npmPath?: string;
  piPath?: string;
  allPiPaths: string[];
  npmGlobalRoot?: string;
  npmMinReleaseAge?: string;
  installedPiPackageVersion?: string;
  latestPiPackageVersion?: string;
  updateAdvice: string[];
}

export interface DoctorReport {
  piVersion?: string;
  nodeVersion: string;
  runtime: RuntimeDiagnostics;
  quietStartup?: boolean;
  welcomeMode?: string;
  safeStartRequested: boolean;
  welcomeDisabled: boolean;
  issues: DoctorIssue[];
  skillCollisions: SkillCollision[];
  staleSkillPaths: StaleSkillPath[];
  availableSkillRoots: AvailableSkillRoot[];
  sfPiPackageDuplicates: SfPiPackageDuplicate[];
}

export interface StartupDoctorNudge {
  issueCount: number;
  collisionCount: number;
  staleSkillPathCount: number;
  packageDuplicateCount: number;
  safeStartRequested: boolean;
  message: string;
  command: string;
}

export interface DoctorFixOptions {
  fixStartup?: boolean;
  fixSkills?: boolean;
  fixStaleSkillPaths?: boolean;
  fixSkillLinks?: boolean;
  home?: string;
  cwd?: string;
  now?: Date;
}

export interface QuarantinedSkill {
  name: string;
  from: string;
  to: string;
}

export interface DoctorFixResult {
  changed: boolean;
  messages: string[];
  quarantinedSkills: QuarantinedSkill[];
  quarantineDir?: string;
}
