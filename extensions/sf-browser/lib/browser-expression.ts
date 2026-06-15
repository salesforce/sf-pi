/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Build a narrow agent-browser eval expression from static helper source and a
 * JSON-serialized payload. This keeps SF Browser mechanically thin while making
 * the dynamic boundary explicit and testable.
 */

const BROWSER_HELPER_NAME_RE = /^__[A-Za-z0-9_]+$/;

export interface BrowserExpressionOptions {
  helpers: string;
  functionName: string;
  payload: unknown;
  stringifyResult?: boolean;
}

export function buildBrowserHelperExpression(options: BrowserExpressionOptions): string {
  if (!BROWSER_HELPER_NAME_RE.test(options.functionName)) {
    throw new Error(`Invalid browser helper name '${options.functionName}'.`);
  }
  const payload = JSON.stringify(options.payload).replace(/</g, "\\u003c");
  const call = `window.${options.functionName}(${payload})`;
  const result = options.stringifyResult ? `JSON.stringify(${call})` : call;
  return `(() => { ${options.helpers} return ${result}; })()`;
}
