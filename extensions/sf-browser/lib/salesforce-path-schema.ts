/* SPDX-License-Identifier: Apache-2.0 */
/** TypeBox schema for structured Salesforce path routes. */
import { Type } from "typebox";

export const SalesforceRouteSchema = Type.Union([
  Type.Object({ type: Type.Literal("home") }),
  Type.Object({
    type: Type.Literal("setup"),
    destination: Type.String({
      description: "Curated Setup Destination, such as setup-home, agentforce-agents, or users.",
    }),
  }),
  Type.Object({
    type: Type.Literal("data-cloud"),
    destination: Type.String({
      description:
        "Data Cloud Destination Pack entry id, such as setup-home. Only verified entries are navigable at runtime.",
    }),
  }),
  Type.Object({
    type: Type.Literal("object-list"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
  }),
  Type.Object({
    type: Type.Literal("object-new"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
  }),
  Type.Object({
    type: Type.Literal("record-view"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
    recordId: Type.String({ description: "15 or 18 character Salesforce record id." }),
  }),
  Type.Object({
    type: Type.Literal("list-view"),
    objectApiName: Type.String({ description: "Salesforce object API name, such as Account." }),
    filterName: Type.String({
      description:
        "List view id, API/developer name, or exact label. sf_browser_open_org verifies and resolves this before navigation.",
    }),
  }),
  Type.Object({
    type: Type.Literal("record-related-list"),
    objectApiName: Type.String({
      description: "Parent Salesforce object API name, such as Account.",
    }),
    recordId: Type.String({ description: "15 or 18 character Salesforce record id." }),
    relatedListApiName: Type.String({
      description:
        "Related list id/API name or exact label, such as Contacts. sf_browser_open_org verifies and resolves this before navigation.",
    }),
  }),
]);
