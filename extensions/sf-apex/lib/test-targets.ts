/* SPDX-License-Identifier: Apache-2.0 */
/** Parse Apex test targets into Tooling test payload items. */

import type { Connection } from "@salesforce/core";
import { toolingQuery } from "./api.ts";
import { ambiguousTargetError } from "./errors.ts";

export interface ApexTestPayloadItem {
  classId?: string;
  className?: string;
  testMethods?: string[];
}

interface ParsedTarget {
  classId?: string;
  className?: string;
  methodName?: string;
}

const APEX_CLASS_ID = /^01p[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

export async function buildApexTestPayloadItems(
  conn: Connection,
  tests: string[],
  classNames: string[],
): Promise<ApexTestPayloadItem[]> {
  const namespaces = await queryKnownNamespaces(conn);
  const parsed = [
    ...classNames.map((target) => parseClassTarget(target)),
    ...tests.map((target) => parseTestTarget(target, namespaces)),
  ];

  const grouped = new Map<string, ApexTestPayloadItem>();
  for (const target of parsed) {
    const key = target.classId ? `id:${target.classId}` : `name:${target.className}`;
    const existing = grouped.get(key) ?? toPayloadItem(target);
    if (target.methodName) {
      existing.testMethods = [...new Set([...(existing.testMethods ?? []), target.methodName])];
    }
    grouped.set(key, existing);
  }
  return [...grouped.values()];
}

export function parseClassTarget(input: string): ParsedTarget {
  const target = cleanTarget(input);
  if (isApexClassId(target)) return { classId: target };
  const parts = target.split(".");
  if (parts.length === 1) return { className: target };
  if (parts.length === 2) return { className: `${parts[0]}.${parts[1]}` };
  throw ambiguousTargetError(`Unsupported Apex class target: ${input}`);
}

export function parseTestTarget(input: string, namespaces: Set<string> = new Set()): ParsedTarget {
  const target = cleanTarget(input);
  if (isApexClassId(target)) return { classId: target };
  const parts = target.split(".");
  if (parts.length === 1) return { className: target };
  if (parts.length === 2) {
    const [first, second] = parts;
    if (namespaces.has(first)) return { className: `${first}.${second}` };
    return { className: first, methodName: second };
  }
  if (parts.length === 3) {
    const [namespace, className, methodName] = parts;
    return { className: `${namespace}.${className}`, methodName };
  }
  throw ambiguousTargetError(`Unsupported Apex test target: ${input}`);
}

export function isApexClassId(value: string): boolean {
  return APEX_CLASS_ID.test(value);
}

async function queryKnownNamespaces(conn: Connection): Promise<Set<string>> {
  const namespaces = new Set<string>();
  await Promise.allSettled([
    toolingQuery<{ NamespacePrefix?: string }>(
      conn,
      "SELECT SubscriberPackage.NamespacePrefix FROM InstalledSubscriberPackage",
    ).then((result) => {
      for (const record of result.records) {
        const namespace = nestedNamespace(record);
        if (namespace) namespaces.add(namespace);
      }
    }),
    toolingQuery<{ NamespacePrefix?: string }>(
      conn,
      "SELECT NamespacePrefix FROM Organization LIMIT 1",
    ).then((result) => {
      for (const record of result.records) {
        if (record.NamespacePrefix) namespaces.add(String(record.NamespacePrefix));
      }
    }),
  ]);
  return namespaces;
}

function toPayloadItem(target: ParsedTarget): ApexTestPayloadItem {
  if (target.classId) return { classId: target.classId };
  return {
    className: target.className,
    ...(target.methodName ? { testMethods: [target.methodName] } : {}),
  };
}

function cleanTarget(input: string): string {
  const target = input.trim();
  if (!target) throw ambiguousTargetError("Apex test target cannot be blank.");
  return target;
}

function nestedNamespace(record: Record<string, unknown>): string | undefined {
  const direct = record.NamespacePrefix;
  if (typeof direct === "string" && direct) return direct;
  const subscriberPackage = record.SubscriberPackage;
  if (subscriberPackage && typeof subscriberPackage === "object") {
    const namespace = (subscriberPackage as { NamespacePrefix?: unknown }).NamespacePrefix;
    if (typeof namespace === "string" && namespace) return namespace;
  }
  return undefined;
}
