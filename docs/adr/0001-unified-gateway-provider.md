# ADR 0001: Unified Gateway Provider

## Status

Accepted

## Context

The gateway extension originally had to support multiple model families with
different wire protocols. Splitting those into multiple Pi providers made model
selection and login flows harder to understand because users saw multiple rows
for what was operationally one gateway credential.

## Decision

Register one Pi provider, `sf-llm-gateway-internal`, and route model families
inside the provider dispatcher. OpenAI-compatible families stay on the
OpenAI-compatible transport. Claude-family models route to the native Anthropic
Messages transport.

## Consequences

- `/login` shows one gateway row.
- Settings migration must rewrite retired provider references.
- Model-family inference and transport dispatch are core contracts and need
  tests when new families are added.
- Docs should describe this as one provider with two transports, not as a
  dual-provider architecture.
