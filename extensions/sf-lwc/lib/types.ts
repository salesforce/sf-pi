/* SPDX-License-Identifier: Apache-2.0 */
/** Shared types for the SF LWC lifecycle tool. */

export type SfLwcAction =
  | "status"
  | "project.scan"
  | "component.list"
  | "component.inspect"
  | "file.diagnose"
  | "test.discover"
  | "test.plan"
  | "test.run"
  | "history.last"
  | "history.rerun";

export interface SfLwcParams {
  action: SfLwcAction;
  workspace?: string;
  package_dir?: string;
  component?: string;
  components?: string[];
  file?: string;
  files?: string[];
  test_file?: string;
  test_name?: string;
  test_pattern?: string;
  limit?: number;
  include_source?: boolean;
  include_dependencies?: boolean;
  include_tests?: boolean;
  report_formats?: Array<"json" | "markdown">;
  timeout_seconds?: number;
  output_mode?: "summary" | "inline" | "file_only";
}

export interface SfLwcSessionState {
  lastRunnable?: SfLwcParams;
  lastDigest?: LwcRunDigest;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface DigestRow {
  icon: string;
  label: string;
  value: string;
}

export interface LwcRunSection {
  icon: string;
  title: string;
  rows: DigestRow[];
}

export interface LwcLocalRailItem {
  kind: string;
  target: string;
  detail?: string;
}

export interface LwcArtifact {
  path: string;
  kind: string;
}

export interface LwcRunDigest {
  action: SfLwcAction;
  kind: string;
  status: "pass" | "fail" | "warning" | "info";
  icon: string;
  title: string;
  workspace?: {
    root?: string;
    project_root?: string;
    api_version?: string;
  };
  scope?: string;
  meta?: string[];
  local_rail?: LwcLocalRailItem[];
  sections: LwcRunSection[];
  artifacts?: LwcArtifact[];
  next_step?: string;
  recommended_tools?: string[];
  recommended_skills?: string[];
}

export interface SfdxProjectInfo {
  projectRoot: string;
  sourceApiVersion?: string;
  packageDirs: PackageDirInfo[];
}

export interface PackageDirInfo {
  path: string;
  fullPath: string;
  default?: boolean;
}

export interface LwcBundleInfo {
  name: string;
  packageDir: string;
  packageDirPath: string;
  lwcRoot: string;
  bundlePath: string;
  files: string[];
  testFiles: string[];
  metadata?: LwcMetadataInfo;
}

export interface LwcMetadataInfo {
  apiVersion?: string;
  isExposed?: boolean;
  masterLabel?: string;
  targets: string[];
}

export interface LwcProjectScan {
  project: SfdxProjectInfo;
  bundles: LwcBundleInfo[];
  omitted: string[];
}

export interface LwcComponentInspection {
  bundle: LwcBundleInfo;
  publicApi: string[];
  apexImports: string[];
  schemaImports: string[];
  labelImports: string[];
  resourceImports: string[];
  childComponents: string[];
  lightningTags: string[];
  diagnostics: LwcDiagnostic[];
  styleSignals: string[];
  source?: Record<string, string>;
}

export interface LwcDiagnostic {
  file: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
  code?: string | number;
  source: "lwc-template" | "lwc-js" | "lwc-meta" | "sf-lwc";
}

export interface LwcTestFile {
  path: string;
  component?: string;
  tests: string[];
}

export interface LwcTestDiscovery {
  project: SfdxProjectInfo;
  runner?: string;
  runnable: boolean;
  testFiles: LwcTestFile[];
}

export interface LwcJestSummary {
  success: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  pendingTests: number;
  totalSuites: number;
  passedSuites: number;
  failedSuites: number;
  durationMs?: number;
  failures: Array<{ file?: string; title: string; message: string }>;
}
