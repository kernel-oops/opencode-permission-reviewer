import { test } from "node:test"
import assert from "node:assert/strict"
import plugin, { parseDecision, readConfig } from "../src/index.js"

const options = { model: { providerID: "example", id: "reviewer" }, timeoutMs: 20 }
const event = () => ({ effect: "ask", action: "shell", resources: ["echo hello"], metadata: { command: "echo hello", cwd: "/workspace" } })
async function host(generate, config = options) {
  let callback, disposed = false
  const cleanup = await plugin.setup({
    options: config,
    permission: { hook: async (name, cb) => { assert.equal(name, "evaluate"); callback = cb; return { dispose: async () => { disposed = true } } } },
    experimental: { generate: { text: generate } },
  })
  return { run: callback, cleanup, disposed: () => disposed }
}

test("explicit model, bounded timeout and policy are mandatory", () => {
  for (const config of [{}, { model: {} }, { ...options, timeoutMs: Infinity }, { ...options, timeoutMs: 0 }, { ...options, policy: "" }]) assert.throws(() => readConfig(config))
  assert.deepEqual(readConfig(options).model, options.model)
})
test("strict exact decision grammar rejects malformed and duplicate keys", () => {
  assert.equal(parseDecision(' {"decision": "ask"}\n'), "ask")
  for (const value of ['{"decision":"allow"}', '{"decision":"ask","extra":1}', '{"decision":"ask","decision":"deny"}', '```{"decision":"ask"}```', "null", {}, "x".repeat(257)]) assert.throws(() => parseDecision(value))
})
test("ask stays human; generation receives only bounded action data", async () => {
  const h = await host(async (input, requestOptions) => {
    assert.deepEqual(input.model, options.model)
    assert.ok(requestOptions.signal instanceof AbortSignal)
    assert.ok(input.prompt.includes('"command":"echo hello"'))
    assert.ok(!input.prompt.includes("secret-transcript"))
    return { text: '{"decision":"ask"}' }
  })
  const e = { ...event(), sessionID: "secret-transcript" }; await h.run(e)
  assert.equal(e.effect, "ask"); await h.cleanup(); assert.ok(h.disposed())
})
test("model deny vetoes", async () => {
  const h = await host(async () => ({ text: '{"decision":"deny"}' }))
  const e = event(); await h.run(e); assert.equal(e.effect, "deny"); await h.cleanup()
})
test("static deny and existing allow are untouched", async () => {
  const h = await host(() => { throw new Error("must not call") })
  for (const effect of ["allow", "deny"]) { const e = { ...event(), effect }; await h.run(e); assert.equal(e.effect, effect) }
  await h.cleanup()
})
test("errors, invalid config, malformed output and oversized input fail closed", async () => {
  for (const generate of [async () => { throw new Error("provider secret") }, async () => ({ text: '{"decision":"allow"}' }), async () => ({ text: "x".repeat(257) }), async () => null]) {
    const h = await host(generate); const e = event(); await h.run(e); assert.equal(e.effect, "deny"); assert.ok(!e.message.includes("secret")); await h.cleanup()
  }
  const h = await host(() => { throw new Error("must not call") }, {}); const e = event(); await h.run(e); assert.equal(e.effect, "deny"); await h.cleanup()
  const big = await host(() => { throw new Error("must not call") }); const request = { ...event(), resources: ["x".repeat(32769)] }; await big.run(request); assert.equal(request.effect, "deny"); await big.cleanup()
})
test("timeout denies even if provider ignores abort; late result cannot approve", async () => {
  let resolve, signal
  const h = await host((_, opts) => { signal = opts.signal; return new Promise(r => { resolve = r }) })
  const e = event(); await h.run(e); assert.equal(e.effect, "deny"); assert.ok(signal.aborted)
  resolve({ text: '{"decision":"ask"}' }); await Promise.resolve(); assert.equal(e.effect, "deny"); await h.cleanup()
})
test("concurrency saturation and unload fail closed", async () => {
  const h = await host(() => new Promise(() => {}), { ...options, timeoutMs: 60000 })
  const requests = Array.from({ length: 4 }, event)
  const promises = requests.map(e => h.run(e))
  const excess = event(); await h.run(excess); assert.equal(excess.effect, "deny")
  await h.cleanup(); await Promise.all(promises)
  for (const e of requests) assert.equal(e.effect, "deny")
})
test("timed-out providers still occupy capacity until actual settlement", async () => {
  let calls = 0
  const h = await host(() => { calls++; return new Promise(() => {}) })
  await Promise.all(Array.from({ length: 4 }, () => h.run(event())))
  const excess = event(); await h.run(excess)
  assert.equal(excess.effect, "deny"); assert.equal(calls, 4); await h.cleanup()
})
