# ADR 0085: Agent Workflow Visibility Contract

Status: accepted

SF Pi will keep agent workflows human-auditable through three existing Pi channels rather than creating a centralized activity timeline. Agent-chosen steps and mutations remain visible tool calls with compact call/result evidence; automatic lifecycle work uses **Human-Only Transcript Rows** for meaningful start and final states; and only actionable findings create agent-visible follow-ups. Routine status never enters model context.

Extensions must not perform hidden durable mutations. Guardrail prompts remain the confirmation seam, and full evidence stays in bounded artifacts referenced by result cards or transcript rows. This contract reuses Pi tool rendering, entry renderers, and normal messages, preserving clear authority and avoiding another cross-extension event framework.
