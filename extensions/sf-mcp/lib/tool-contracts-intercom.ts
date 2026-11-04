/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Reviewed Intercom MCP tool contract (Fin, formerly Intercom), from the
 * published Intercom developer MCP guide and Fin Operator MCP guide.
 *
 * The five Fin Operator tools appear only for OAuth connections whose teammate
 * has Operator access; on other workspaces they are documented but not
 * advertised, and SF MCP keeps them hidden as unavailable.
 */
import { defineTools } from "./tool-contract-types.ts";

export const INTERCOM_DATA_TOOLS = defineTools([
  [
    "search",
    "Search conversations or contacts with Intercom's query DSL (object_type, field operators, free text).",
    "Conversation and contact search",
    "read",
  ],
  [
    "fetch",
    "Fetch full details for a conversation, contact, or company returned by search.",
    "Record retrieval",
    "read",
  ],
  [
    "search_conversations",
    "Search conversations by ids, source, author, state, assignee, and timing statistics.",
    "Conversation search",
    "read",
  ],
  [
    "get_conversation",
    "Get one conversation with all parts and metadata.",
    "Conversation retrieval",
    "read",
  ],
  [
    "search_contacts",
    "Search contacts by ids, name, email, phone, custom attributes, or email domain.",
    "Contact search",
    "read",
  ],
  [
    "get_contact",
    "Get a contact's attributes, location, and activity timestamps.",
    "Contact retrieval",
    "read",
  ],
  [
    "list_companies",
    "List companies, optionally filtered by name, company id, tag, or segment.",
    "Company discovery",
    "read",
  ],
  ["get_company", "Get a company's attributes, segments, and tags.", "Company retrieval", "read"],
  ["list_articles", "List Help Center articles.", "Help Center discovery", "read"],
  [
    "search_articles",
    "Search Help Center articles by phrase, state, or Help Center.",
    "Help Center search",
    "read",
  ],
  [
    "get_article",
    "Get a Help Center article with its HTML body and collection.",
    "Help Center retrieval",
    "read",
  ],
  [
    "create_article",
    "Create a Help Center article (draft by default).",
    "Help Center authoring",
    "write",
  ],
  [
    "update_article",
    "Update a Help Center article's content, author, state, or parent.",
    "Help Center authoring",
    "write",
  ],
  [
    "add_internal_note",
    "Add a teammate-only internal note to a conversation; may unsnooze it.",
    "Conversation notes",
    "write",
  ],
]);

export const INTERCOM_OPERATOR_TOOLS = defineTools([
  [
    "send_operator_message",
    "Start or continue an asynchronous Fin Operator turn that works inside the workspace and consumes Operator usage.",
    "Fin Operator turns",
    "mixed",
  ],
  [
    "get_operator_response",
    "Read the current state, answer, questions, approvals, and proposals of an Operator chat.",
    "Fin Operator turns",
    "read",
  ],
  [
    "get_proposal_details",
    "Show the before and after of each pending Operator proposal.",
    "Fin Operator proposals",
    "read",
  ],
  [
    "apply_proposals",
    "Apply Operator proposals to live workspace configuration; some changes cannot be undone.",
    "Fin Operator proposals",
    "destructive",
  ],
  [
    "reject_proposals",
    "Discard pending Operator proposals without changing the workspace.",
    "Fin Operator proposals",
    "write",
  ],
]);

export const INTERCOM_MCP_TOOLS = [...INTERCOM_DATA_TOOLS, ...INTERCOM_OPERATOR_TOOLS] as const;
