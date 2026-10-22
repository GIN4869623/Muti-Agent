import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const dir = mkdtempSync(join(tmpdir(), "knowledge-answer-"));
const compile = (url) => ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
writeFileSync(join(dir, "config.cjs"), "let config=null;exports.setConfig=v=>config=v;exports.loadKnowledgeAnswerConfig=()=>config;");
writeFileSync(join(dir, "route.cjs"), compile(new URL("../src/app/api/integrations/knowledge/answer/route.ts", import.meta.url))
  .replaceAll('"@/lib/integrations/knowledge-config"', '"./config.cjs"'));
writeFileSync(join(dir, "answer.cjs"), compile(new URL("../src/lib/integrations/knowledge-answer.ts", import.meta.url)));
const require = createRequire(import.meta.url);
const { POST } = require(join(dir, "route.cjs"));
const { setConfig } = require(join(dir, "config.cjs"));
const { parseKnowledgeAnswer } = require(join(dir, "answer.cjs"));
rmSync(dir, { recursive: true, force: true });
const config = { answerUrl: "http://knowledge.test/api/knowledge/answer", apiKey: "answer-only-key", timeoutMs: 350000 };
const request = (body) => new Request("http://console.test/api/integrations/knowledge/answer", { method: "POST", body: JSON.stringify(body) });
const fixture = { request_id: "same-request", sender: "知识库", question: "设备是什么？", answer: "这是传感终端。", llm_used: true, status: "success", hits: [
  { rank: 1, chunk_id: "chunk-1", document_id: "document-1", score: 0.8, title: "原文", text: "# 原始切片\n\n保留换行与正文。" },
] };

test("the answer proxy forwards the sender and returns exact answer/evidence together", async t => {
  setConfig(config);
  let outgoing;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    outgoing = { url, body: JSON.parse(options.body), key: options.headers["X-Knowledge-API-Key"] };
    return Response.json(fixture);
  });
  const response = await POST(request({ sender: "网络监管智能体", question: fixture.question, request_id: "same-request" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), fixture);
  assert.equal(outgoing.url, config.answerUrl);
  assert.equal(outgoing.key, "answer-only-key");
  assert.equal(outgoing.body.sender, "网络监管智能体");
  assert.equal(outgoing.body.request_id, "same-request");
});
test("legacy panel submissions receive a request id", async t => {
  setConfig(config);
  let id;
  t.mock.method(globalThis, "fetch", async (_, options) => { id = JSON.parse(options.body).request_id; return Response.json(fixture); });
  assert.equal((await POST(request({ question: fixture.question }))).status, 200);
  assert.ok(typeof id === "string" && id.length > 10);
});
test("missing answer configuration and invalid payloads do not invoke the upstream", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected"); });
  setConfig(null); assert.equal((await POST(request({ question: "test" }))).status, 503);
  setConfig(config); assert.equal((await POST(request([]))).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});
test("busy and model errors stay explicit", async t => {
  setConfig(config);
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "问答服务繁忙" }, { status: 429 }));
  const response = await POST(request({ question: "test" }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).detail, "问答服务繁忙");
});
test("upstream timeouts return a useful timeout error", async t => {
  setConfig(config);
  t.mock.method(globalThis, "fetch", async () => { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; });
  assert.equal((await POST(request({ question: "test" }))).status, 504);
});
test("answer parsing accepts no-evidence responses and refuses missing original text", () => {
  assert.deepEqual(parseKnowledgeAnswer(fixture), fixture);
  const empty = { ...fixture, llm_used: false, status: "failed", hits: [], answer: "没有足够证据" };
  assert.equal(parseKnowledgeAnswer(empty).llm_used, false);
  assert.throws(() => parseKnowledgeAnswer({ ...fixture, hits: [{ ...fixture.hits[0], text: undefined }] }));
});

test("ordinary queries forward the selected cloud or local model without changing sender", async t => {
  setConfig(config);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return Response.json({ ...fixture, model_profile: body.model_profile });
  });
  for (const model_profile of ["cloud", "local"]) {
    const response = await POST(request({ sender: "普通检索", question: fixture.question, model_profile }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model_profile, model_profile);
  }
  assert.deepEqual(calls.map(call => [call.sender, call.model_profile]), [["普通检索", "cloud"], ["普通检索", "local"]]);
});
