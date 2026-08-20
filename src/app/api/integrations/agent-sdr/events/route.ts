export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent_SDR event proxy — DEPRECATED.
 *
 * 多后端场景下无单一代理目标，前端统一使用 /api/integrations/agent-events。
 * 保留此端点避免 404，始终返回 204。
 */
export async function GET() {
  return new Response(null, { status: 204 });
}
