/* SPDX-License-Identifier: Apache-2.0 */

export type IssueKind = "bug" | "feature" | "setup" | "feedback";

export interface FeedbackDraft {
  kind: IssueKind;
  title: string;
  summary: string;
  expected: string;
  steps: string;
}

export interface CommandResult {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface ToolAvailability {
  name: string;
  available: boolean;
  detail?: string;
}

export interface GithubStatus {
  ghAvailable: boolean;
  authenticated: boolean;
  login?: string;
  detail?: string;
}

export interface Diagnostics {
  sfPiVersion: string;
  piVersion: string;
  nodeVersion: string;
  npmVersion: string;
  platform: NodeJS.Platform;
  osRelease: string;
  arch: string;
  shell: string;
  terminal: string;
  term: string;
  colorTerm: string;
  locale: string;
  terminalSize: string;
  isCI: boolean;
  isTty: boolean;
  cwd: string;
  gitInsideWorkTree: boolean;
  gitBranch: string;
  gitStatusSummary: string;
  gitRemote: string;
  sfCliVersion: string;
  sfCliPlugins: string;
  sfOrgConnected: string;
  sfOrgApiVersion: string;
  enabledExtensions: string[];
  disabledExtensions: string[];
  github: GithubStatus;
  tools: ToolAvailability[];
}
