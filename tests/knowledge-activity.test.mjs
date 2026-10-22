import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const dir = mkdtempSync(join(tmpdir(), "knowledge-state-"));
const file = join(dir, "activity.cjs");
writeFileSync(file, ts.transpileModule(readFileSync(new URL("../src/lib/integrations/knowledge-activity.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText);
writeFileSync(join(dir, "knowledge-routing.js"), ts.transpileModule(readFileSync(new URL("../src/lib/integrations/knowledge-routing.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText);
const { resolveKnowledgeSender: resolve, normalizeKnowledgeEvent: normalize, getKnowledgeLink: link } = createRequire(import.meta.url)(join(dir, "knowledge-routing.js"));
const { emptyKnowledgeActivity: empty, consumeKnowledgeEvents: consume, advanceKnowledgeActivity: advance, TRANSFER_MS } = createRequire(import.meta.url)(file);
rmSync(dir, { recursive: true, force: true });
const event = (runId, phase, extra = {}) => normalize({ type: "agent.activity", agentId: "rag", toolName: "shared_knowledge_search", delivery: "live", runId, phase, eventId: `${runId}-${phase}`, args: { sender: "编排智能体" }, ...extra });

test("fast response queues reverse motion after the outgoing motion", () => {
  const state = consume(empty(), [event("a", "completed"), event("a", "received")], 1000);
  assert.deepEqual(state.transfers.map(t => t.direction), ["request", "response"]);
  assert.ok(state.transfers[1].startsAt >= state.transfers[0].endsAt);
  assert.ok(TRANSFER_MS >= 3000);
  assert.ok(state.transfers.every(t => t.endsAt - t.startsAt === TRANSFER_MS));
  assert.equal(Object.keys(advance(state, state.transfers[1].endsAt + 1).runs).length, 0);
});
test("requests remain busy while waiting for a response", () => {
  const state = advance(consume(empty(), [event("a", "received")], 1000), 5000);
  assert.equal(state.transfers.length, 0); assert.equal(Object.keys(state.runs).length, 1);
});
test("concurrent requests finish independently", () => {
  let state = consume(empty(), [event("b", "received"), event("a", "received")], 1000);
  state = consume(state, [event("a", "completed")], 3000);
  state = advance(state, state.runs.a.expiresAt + 1);
  assert.deepEqual(Object.keys(state.runs), ["b"]);
});
test("failure cancels only its own motion and does not send a success return", () => {
  let state = consume(empty(), [event("b", "received"), event("a", "received")], 1000);
  state = consume(state, [event("a", "failed")], 1100);
  assert.equal(state.runs.a, undefined); assert.ok(state.runs.b);
  assert.ok(state.transfers.every(t => t.runId === "b")); assert.equal(state.lastError, true);
});
test("historical replay never starts motion", () => {
  const state = consume(empty(), [event("a", "completed", { delivery: "replay" }), event("a", "received", { delivery: "replay" })], 1000);
  assert.equal(state.transfers.length, 0); assert.equal(Object.keys(state.runs).length, 0);
});
test("duplicate SSE messages are idempotent", () => {
  let state = consume(empty(), [event("a", "received")], 1000);
  state = consume(state, [event("a", "received")], 1100);
  assert.equal(state.transfers.length, 1);
});
test("missing terminal event times out rather than staying busy forever", () => {
  const state = advance(consume(empty(), [event("a", "received")], 1000), 127000);
  assert.equal(Object.keys(state.runs).length, 0); assert.equal(state.transfers.length, 0);
});
test("other agent tools cannot animate the knowledge link", () => {
  const state = consume(empty(), [event("a", "received", { toolName: "perform_physical_scan" })], 1000);
  assert.equal(state.transfers.length, 0);
});

test("caller aliases resolve centrally and unknown callers never become supervisor", () => {
  assert.equal(resolve("协同编排智能体").id, "supervisor");
  assert.equal(resolve(" 网络监管智能体 ").id, "usrp");
  assert.equal(resolve("USRP").id, "usrp");
  for (const sender of [undefined, "第三方测试平台", "编排智能体-其他系统"]) {
    const peer = resolve(sender);
    assert.equal(peer.id, "external");
    assert.equal(link(peer.id), null);
  }
});
test("the event receiver derives endpoints from sender even for legacy publishers", () => {
  for (const phase of ["received", "started", "completed", "failed"]) {
    const e = event("net", phase, { args: { sender: "网络监管智能体", request_id: "business-1" }, sourceAgentId: "supervisor", targetAgentId: "rag" });
    const outgoing = ["completed", "failed"].includes(phase);
    assert.equal(e.sourceAgentId, outgoing ? "rag" : "usrp");
    assert.equal(e.targetAgentId, outgoing ? "usrp" : "rag");
    assert.equal(e.args.request_id, "business-1");
  }
});
test("network and supervisor traffic have independent visual routes", () => {
  const state = consume(empty(), [event("net", "received", { args: { sender: "网络监管智能体" } }), event("orchestrator", "received")], 1000);
  const [a, b] = state.transfers;
  assert.notEqual(a.peer.id, b.peer.id);
  assert.notEqual(link(a.peer.id).request, link(b.peer.id).request);
});
test("simultaneous callers sharing a business id return on their own routes", () => {
  let state = consume(empty(), [event("net", "received", { args: { sender: "网络监管智能体", request_id: "same" } }), event("sup", "received", { args: { sender: "编排智能体", request_id: "same" } })], 1000);
  state = consume(state, [event("sup", "completed"), event("net", "completed", { args: { sender: "网络监管智能体" } })], 1100);
  for (const [runId, peerId] of [["net", "usrp"], ["sup", "supervisor"]]) {
    const pair = state.transfers.filter(t => t.runId === runId);
    assert.deepEqual(pair.map(t => t.direction), ["request", "response"]);
    assert.ok(pair.every(t => t.peer.id === peerId));
    assert.ok(pair[1].startsAt >= pair[0].endsAt);
  }
});
test("a response keeps its original peer rather than switching with later metadata", () => {
  let state = consume(empty(), [event("a", "received", { args: { sender: "网络监管智能体" } })], 1000);
  state = consume(state, [event("a", "completed", { args: { sender: "编排智能体" } })], 1100);
  assert.ok(state.transfers.every(t => t.peer.id === "usrp"));
});
test("external callers retain their name without getting a fabricated graph edge", () => {
  const state = consume(empty(), [event("x", "completed", { args: { sender: "第三方平台" } }), event("x", "received", { args: { sender: "第三方平台" } })], 1000);
  assert.equal(state.transfers.length, 2);
  assert.ok(state.transfers.every(t => t.peer.id === "external" && t.peer.name === "第三方平台" && !link(t.peer.id)));
});
test("failed network requests do not remove a different caller's animation", () => {
  let state = consume(empty(), [event("net", "received", { args: { sender: "网络监管智能体" } }), event("sup", "received")], 1000);
  state = consume(state, [event("net", "failed", { args: { sender: "网络监管智能体" } })], 1100);
  assert.ok(!state.runs.net && state.runs.sup);
  assert.ok(state.transfers.every(t => t.peer.id === "supervisor"));
});

test("answer generation remains active beyond the short search timeout", () => {
  const state = advance(consume(empty(), [event("answer", "received", { toolName: "knowledge_answer" })], 1000), 200000);
  assert.ok(state.runs.answer);
  const completed = consume(state, [event("answer", "completed", { toolName: "knowledge_answer" })], 201000);
  assert.equal(completed.transfers[0].direction, "response");
});
test("a failed answer does not cancel a simultaneous raw search", () => {
  let state = consume(empty(), [event("answer", "received", { toolName: "knowledge_answer" }), event("search", "received")], 1000);
  state = consume(state, [event("answer", "failed", { toolName: "knowledge_answer" })], 1100);
  assert.ok(state.runs.search && !state.runs.answer);
  assert.ok(state.transfers.every(transfer => transfer.runId === "search"));
});

test("ordinary queries remain busy but have no agent or external transfer animation", () => {
  assert.equal(resolve("普通检索").id, "direct");
  assert.equal(link("direct"), null);
  const received = event("plain", "received", { args: { sender: "普通检索" }, toolName: "knowledge_answer" });
  assert.equal(received.sourceAgentId, "direct");
  let state = consume(empty(), [received, event("sup", "received")], 1000);
  assert.ok(state.runs.plain && state.runs.sup);
  assert.ok(state.transfers.every(transfer => transfer.runId === "sup"));
  state = consume(state, [event("plain", "completed", { args: { sender: "普通检索" }, toolName: "knowledge_answer" })], 1100);
  assert.ok(!state.runs.plain && state.runs.sup);
  assert.ok(state.transfers.every(transfer => transfer.runId === "sup"));
});
