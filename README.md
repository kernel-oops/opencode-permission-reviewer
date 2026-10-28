# OpenCode permission reviewer

A small, model-neutral **veto-only** permission reviewer for stock OpenCode 2.2.
It reviews pending `ask` decisions using a model you explicitly select. It can
deny a clear policy violation or leave the request for the normal human approval
flow. **It never automatically approves an action**, and cannot override a static
deny. Existing host allows are not reviewed.

This is a conservative public edition of a deployment-specific reviewer, not a
drop-in copy. Trusted root-human provenance, delegated evidence, constrained-output
acknowledgements and special one-use refusal overrides are not public stock APIs
and are deliberately omitted. Without those contracts, automatic approval is
omitted too. Plaintext JSON is strictly validated, not claimed to be constrained
decoding. No custom OpenCode build is required.

## Configuration

Install the package through OpenCode's V2 `plugins` configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "@kerneloops/opencode-permission-reviewer@0.1.0",
    "options": {
      "model": { "providerID": "your-provider", "id": "your-model" },
      "timeoutMs": 15000
    }
  }]
}
```

There is no default provider or model. Configure provider authentication in
OpenCode, not in this plugin. `policy` optionally replaces the example policy as
a string (maximum 16 KiB). `timeoutMs` is an integer from 1 to 60000, default 15000.
The bundled [example policy](examples/policy.txt) requires human approval and
identifies clear high-impact risks; it contains no personal standing permissions.
Invalid configuration denies pending asks, rather than disabling the reviewer.
Remove the plugin from configuration to disable it deliberately.

Model errors, timeouts, cancellation, malformed responses, oversized requests
(over 32 KiB), and more than four concurrent reviews deny the affected request.
An unanswered model request never becomes an approval. Cleanup aborts pending
requests and disposes the hook. Cancellation is best-effort at the provider;
the hook has its own timeout even if the provider ignores abort.

## Threat model and privacy

**A model reviewer is not a sandbox or an authorisation boundary.** The host's
permission enforcement remains authoritative. A model can misunderstand risks,
be prompt-injected, or deny legitimate actions. The operator's policy is trusted
configuration; action metadata and resource strings are untrusted. No transcript,
assistant claim, tool output or metadata is treated as human consent. A model
mistake cannot automatically approve a pending ask in this edition, but can
cause a denial. Normal human approval still requires care.

The plugin sends the action name, resources and metadata to your configured
model provider. These can contain full commands, paths, secrets or private data:
**do not enable it for sensitive requests unless that provider is authorised to
receive them**. The plugin does not redact context or inspect files, and it
does not persist or log prompts, model output, session identifiers or decisions.
The provider and OpenCode may retain their own logs. Generation is session-less
and tool-less via `ctx.experimental.generate.text`.

Other installed plugins are trusted code. Hooks run in plugin order; a later
plugin can change this plugin's result. Install this reviewer last, and do not
combine it with a plugin that broadens decisions after it. This is not a defence
against malicious plugins, a compromised host, TOCTOU changes to files, or tools
which fail to request permission. It does not review already-allowed actions.

## Development and compatibility

Node.js 22+ or Bun; no runtime dependencies. `npm test` uses synthetic fixtures
and no provider credentials, paid calls or live session state. `npm pack --dry-run`
shows the narrow release allowlist. MIT; author Marc.

Target: stock OpenCode **2.2.0**, using only the public permission evaluate hook
and experimental stateless text generation. The experimental API may change.
Contract and simulated-hook tests do not measure model quality or guarantee a
provider's cancellation/retention behaviour. See the release evidence for the
exact checks performed; no live provider qualification is implied.
