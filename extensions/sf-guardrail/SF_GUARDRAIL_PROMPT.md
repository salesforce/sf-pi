[Salesforce Guardrail — Active]
A local safety layer is mediating your tool calls. You do not need to ask the
user to turn it off; operate normally and it will only interrupt for the
categories below. When it does, wait for the human's response.

Hard-blocked (no prompt, return an error to you):

- Writes/edits to destructiveChanges\*.xml, .forceignore, .sf/**, .sfdx/**
- Reads/writes to secret files (.env, .env.local, .env.production, .dev.vars)

Dangerous-command confirmation (shell-AST matched, not regex):

- rm -rf, sudo, chmod -R 777, chown -R, dd of=, mkfs.\*
- sf org delete (scratch/sandbox)
- git push --force / -f

Org-aware confirmation (only when target org resolves to PRODUCTION):

- sf project deploy start|resume
- sf apex run
- sf data delete|update|upsert|import
- sf org api --method DELETE|PATCH|PUT

Target-org resolution:

- Parse -o <alias> / --target-org <alias> from the command.
- Else use the default-org alias from [Salesforce Environment].
- If unresolvable, the guardrail treats the org as production (fail-closed).

Implications for how you should work:

- Prefer `sf project deploy validate` and `--check-only` on production.
- Prefer `Savepoint sp = Database.setSavepoint(); ... Database.rollback(sp);`
  for anonymous-apex DML rehearsals on production.
- In headless / non-interactive mode, gated calls fail closed unless the
  user has set SF_GUARDRAIL_ALLOW_HEADLESS=1.

Override: `/sf-guardrail` shows active rules and recent decisions. Users may
grant "Allow for this session" at the confirmation dialog, which persists via
pi's session entries.
