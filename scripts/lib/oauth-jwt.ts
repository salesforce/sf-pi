/* SPDX-License-Identifier: Apache-2.0 */
/** RS256 JWT signing for disposable OAuth runtime proofs, not password hashing. */
import { createSign } from "node:crypto";

export function signJwt(payload: Record<string, unknown>, privateKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey).toString("base64url")}`;
}
