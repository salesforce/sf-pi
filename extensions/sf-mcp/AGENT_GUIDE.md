# SF MCP Agent Guide

Use SF MCP to configure Salesforce-published MCP servers over Pi's native MCP
runtime. Pi owns transport, OAuth, connection state, resources, and tool
execution; `/mcp` remains the connection-management surface.

## Configuration workflow

1. Open `/sf-mcp` and use the Manager settings panel.
2. Review capability overlap and choose the recommended complementary profile
   unless the user explicitly needs side-by-side MCP behavior.
3. Review scope, endpoint, exposure, approved tools, and any Alpha or Beta note.
4. Apply the preset, reload Pi, then use `/mcp` to connect or sign in.
5. Adopt an existing entry only when SF MCP reports it compatible. Use the
   redacted diff before an explicit reset or repair.

## Exact target verification before SObject writes

1. Use only a configured SObject Mutations, Deletes, or All server.
2. Call `sf_mcp_verify_target` with:
   - the exact configured server preset name;
   - an explicit Salesforce CLI alias or username;
   - the exact next mutation tool.
3. The verifier performs a read-only `Organization` fingerprint through that
   same MCP OAuth connection and compares it with the CLI target.
4. Call the named mutation immediately after verification. The evidence is
   session-local, configuration-bound, one-use, and expires after two minutes.
5. Re-run verification before every later mutation, including rollback or
   fixture restoration.

Verification is not approval. SF Guardrail still asks before an attested sandbox
write and blocks production, unknown, mismatched, expired, or unattested writes.
Never switch the target between verification and mutation.

## Boundaries

- Never inspect or copy Pi's MCP OAuth credential store.
- Never infer org identity from endpoint class, username, alias, or record data.
- Never start a second MCP client to bypass Pi's runtime.
- Hosted mutation servers without exact organization identity evidence remain
  fail-closed.
- New observed tools remain hidden until a reviewed preset revision approves
  them.
- Content presets are SF Pi Alpha while Salesforce documents Agentforce Vibes as
  their only supported client.
