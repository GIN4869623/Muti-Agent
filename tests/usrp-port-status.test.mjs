import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "usrp-status-"));
const compile = (url) => ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
writeFileSync(join(dir, "tcp.cjs"), compile(new URL("../src/lib/integrations/tcp-port.ts", import.meta.url)));
writeFileSync(join(dir, "targets.cjs"), "let targets=[]; exports.setTargets=v=>targets=v; exports.loadAgentBackendTargets=()=>targets;");
writeFileSync(join(dir, "response.cjs"), "exports.NextResponse={json:(data,options)=>Response.json(data,options)};");
writeFileSync(join(dir, "route.cjs"), compile(new URL("../src/app/api/integrations/agent-sdr/status/route.ts", import.meta.url))
  .replaceAll('"next/server"', '"./response.cjs"')
  .replaceAll('"@/lib/integrations/agent-backend-config"', '"./targets.cjs"')
  .replaceAll('"@/lib/integrations/tcp-port"', '"./tcp.cjs"'));
const require = createRequire(import.meta.url);
const { isTcpPortOpen } = require(join(dir, "tcp.cjs"));
const { setTargets } = require(join(dir, "targets.cjs"));
const { GET } = require(join(dir, "route.cjs"));
rmSync(dir, { recursive: true, force: true });

async function openPort(t) {
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function closedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  return url;
}

test("an open TCP port is online even without working HTTP status endpoints", async t => {
  const baseUrl = await openPort(t);
  setTargets([{ backendId: "agent-sdr", kind: "agent-sdr", baseUrl }]);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  const body = await (await GET()).json();
  assert.equal(body.agents.usrp.connected, true);
  assert.equal(body.agents.usrp.status, "就绪");
});

test("a false UHD flag cannot mark an open service port offline", async t => {
  const baseUrl = await openPort(t);
  setTargets([{ backendId: "agent-sdr", kind: "agent-sdr", baseUrl }]);
  t.mock.method(globalThis, "fetch", async url => Response.json(String(url).endsWith("hardware_status")
    ? { diagnostics: { uhd_available: false, center_freq: 100000000 }, visualization_active: false }
    : { status: "ok" }));
  const body = await (await GET()).json();
  assert.equal(body.agents.usrp.connected, true);
  assert.equal(body.agents.usrp.metrics[0].value, "100 MHz");
});

test("a closed port is offline even if HTTP diagnostics would claim ready", async t => {
  const baseUrl = await closedPort();
  setTargets([{ backendId: "agent-sdr", kind: "agent-sdr", baseUrl }]);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ ready: true }));
  const body = await (await GET()).json();
  assert.equal(body.agents.usrp.connected, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test("RIS health detection stays independent of the USRP port", async t => {
  const baseUrl = await closedPort();
  setTargets([{ backendId: "agent-sdr", kind: "agent-sdr", baseUrl }, { backendId: "ris-agent", kind: "ris", baseUrl: "http://ris.test:8001" }]);
  t.mock.method(globalThis, "fetch", async url => Response.json(String(url).endsWith("/api/health") ? { ready: true } : { orchestrator: "test" }));
  const body = await (await GET()).json();
  assert.equal(body.agents.usrp.connected, false);
  assert.equal(body.agents["ris-agent"].connected, true);
});

test("malformed targets fail cleanly without attempting a connection", async () => {
  assert.equal(await isTcpPortOpen("invalid"), false);
  assert.equal(await isTcpPortOpen("file:///tmp/test"), false);
});
