/* SPDX-License-Identifier: Apache-2.0 */
export type ExplorerMode = "soql" | "sosl" | "sql";

export type SpaRow = Record<string, unknown>;

export interface RunResult {
  rows: SpaRow[];
  columns: string[];
  totalReturned: number;
  raw: unknown;
  query: string;
  mode: ExplorerMode;
  targetOrg: string;
  apiVersion?: string;
}

export interface CatalogLoad<TObject> {
  value: TObject[];
  cached: boolean;
  loadedAt: number;
  kindLabel: string;
}

export interface FieldsLoad<TField> {
  value: TField[];
  cached: boolean;
  loadedAt: number;
  kindLabel: string;
}

export interface QueryBuildState<TObject> {
  selectedObject: TObject | undefined;
  selectedFieldNames: string[];
  whereClause: string;
  limit: number;
}

export interface QueryValidationResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

export interface ExplorerStrategy<TObject, TField> {
  mode: ExplorerMode;
  whereLabel: string;
  limitLabel: string;
  defaultLimit: number;
  title(org: string): string;
  objectKindLabel(): string;
  initialObjects(): TObject[];
  initialCacheLine(): string;
  loadCatalog(force: boolean): Promise<CatalogLoad<TObject>>;
  loadFields(obj: TObject, force: boolean): Promise<FieldsLoad<TField>>;
  objectName(obj: TObject): string;
  objectDisplayName(obj: TObject): string;
  objectSubtitle(obj: TObject): string;
  objectQueryHay(obj: TObject): string;
  objectRow?(
    obj: TObject,
    selected: boolean,
    active: boolean,
    width: number,
    theme: { bold: (s: string) => string; fg: (color: string, s: string) => string },
  ): string[];
  fieldName(field: TField): string;
  fieldLabel(field: TField): string;
  fieldQueryHay(field: TField): string;
  fieldTypeLabel(field: TField): string;
  defaultFieldSelections(fields: TField[]): string[];
  buildQuery(state: QueryBuildState<TObject>): string;
  validateQuery(queryText: string): QueryValidationResult;
  runQuery(queryText: string, signal?: AbortSignal): Promise<RunResult>;
  exportBaseName(state: QueryBuildState<TObject>): string;
  alternateCatalog?: { label: string; toggle: () => Promise<void> };
}
