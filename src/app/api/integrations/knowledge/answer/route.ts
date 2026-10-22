import { randomUUID } from "node:crypto";
import { loadKnowledgeAnswerConfig } from "@/lib/integrations/knowledge-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = loadKnowledgeAnswerConfig();
  if (!config) return Response.json({ detail: "知识库问答接口尚未连接" }, { status: 503 });
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ detail: "请求必须是 JSON" }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ detail: "请求必须是 JSON 对象" }, { status: 400 });
  }
  const body = { ...(payload as Record<string, unknown>) };
  if (body.request_id == null) body.request_id = randomUUID();
  try {
    const response = await fetch(config.answerUrl, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Knowledge-API-Key": config.apiKey },
      body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(config.timeoutMs),
    });
    const data = await response.json();
    return Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return Response.json({ detail: timeout ? "问答处理超时，请稍后重试" : "知识库问答服务暂时不可用" }, { status: timeout ? 504 : 502 });
  }
}
