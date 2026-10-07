/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { presentSfData360Result } from "../lib/result.ts";

describe("sf_data360 Run Card result presentation", () => {
  it("shows useful collection counts without writing a small-read artifact", async () => {
    const result = await presentSfData360Result(
      { action: "prepare.stream.list" },
      {
        ok: true,
        action: "prepare.stream.list",
        namespace: "prepare",
        targetOrg: "ExampleSandbox",
        response: { dataStreams: [{ name: "ExampleStream" }], totalSize: 1 },
        summary: "Listed data streams",
      },
      "summary",
    );
    expect(result.content[0]?.text).toContain("1 resource");
    expect(result.details.digest).toMatchObject({
      namespace: "prepare",
      sections: expect.arrayContaining([
        expect.objectContaining({
          title: "Data Streams",
          table: expect.objectContaining({ rows: [["ExampleStream"]] }),
        }),
      ]),
    });
    expect(result.details).not.toHaveProperty("artifactPath");
  });

  it("counts connector and other collection arrays without a total field", async () => {
    const result = await presentSfData360Result(
      { action: "connect.connector.list" },
      {
        ok: true,
        action: "connect.connector.list",
        namespace: "connect",
        transport: "connect",
        response: {
          connectorInfoList: [
            { name: "ExampleOne", label: "Example One" },
            { name: "ExampleTwo", label: "Example Two" },
          ],
        },
        summary: "Listed connectors",
      },
      "summary",
    );

    expect(result.content[0]?.text).toContain("2 resources");
  });

  it("persists error evidence while creating a failure Run Card", async () => {
    const result = await presentSfData360Result(
      { action: "prepare.datakit.list" },
      { ok: false, action: "prepare.datakit.list", error: "platform error", summary: "HTTP 500" },
      "summary",
    );
    expect(result.content[0]?.text).toContain("❌");
    expect(result.details).toHaveProperty("artifactPath");
    expect(result.details.digest).toMatchObject({ status: "fail", namespace: "prepare" });
  });
});
