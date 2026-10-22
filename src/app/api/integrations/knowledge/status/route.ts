import { loadKnowledgeConfig } from "@/lib/integrations/knowledge-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadKnowledgeConfig();
  const fallback = { connected: false, chunk_count: null, retrieval_method: "--", embedding_model: "--", checked_at: new Date().toISOString() };
  if (!config) return Response.json(fallback, { headers: { "Cache-Control": "no-store" } });
  try {
    const response = await fetch(`${config.baseUrl}/api/shared-knowledge/status`, {
      headers: { "X-Knowledge-API-Key": config.apiKey }, cache: "no-store", signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error("Knowledge status unavailable");
    const data = await response.json();
    return Response.json({
      connected: data.connected === true,
      chunk_count: Number.isInteger(data.chunk_count) && data.chunk_count >= 0 ? data.chunk_count : null,
      retrieval_method: typeof data.retrieval_method === "string" ? data.retrieval_method : "--",
      embedding_model: typeof data.embedding_model === "string" ? data.embedding_model : "--",
      checked_at: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(fallback, { headers: { "Cache-Control": "no-store" } });
  }
}
