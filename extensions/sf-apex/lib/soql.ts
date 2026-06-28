/* SPDX-License-Identifier: Apache-2.0 */
/** SOQL literal helpers for sf-apex Tooling queries. */

export function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function quoteSoql(value: string): string {
  return `'${escapeSoql(value)}'`;
}
