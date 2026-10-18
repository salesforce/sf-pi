/* SPDX-License-Identifier: Apache-2.0 */
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signJwt } from "../lib/oauth-jwt.ts";

describe("OAuth proof JWT signatures", () => {
  it("verifies RS256 with the public key and rejects a modified payload", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const payload = { iss: "public-client-id", sub: "example-subject", exp: 1234567890 };
    const [header, body, signature] = signJwt(payload, privateKey).split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(body!, "base64url").toString())).toEqual(payload);
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${body}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    const modifiedBody = Buffer.from(
      JSON.stringify({ ...payload, sub: "modified-subject" }),
    ).toString("base64url");
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${modifiedBody}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(false);
  });
});
