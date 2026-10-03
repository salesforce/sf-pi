/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce record-id normalization for URL surfaces that require 15-character ids. */

const SALESFORCE_ID_RE = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/u;

export function salesforce15CharId(value: string): string {
  const normalized = value.trim();
  if (!SALESFORCE_ID_RE.test(normalized)) {
    throw new Error("Expected a 15 or 18 character Salesforce id.");
  }
  return normalized.slice(0, 15);
}
