import { isAgentSdrActivityEvent } from "@/lib/integrations/agent-sdr";
import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";
import { isKnowledgeActivityTool } from "@/lib/integrations/knowledge-activity";

import { normalizeKnowledgeEvent } from "@/lib/integrations/knowledge-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = process.env.KNOWLEDGE_EVENT_TOKEN?.trim();
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized knowledge event publisher" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isAgentSdrActivityEvent(payload) || !isKnowledgeActivityTool(payload.toolName) || payload.agentId !== "rag" || !payload.runId ||
      !["received", "started", "completed", "failed"].includes(payload.phase)) {
    return Response.json({ error: "Invalid knowledge event" }, { status: 400 });
  }
  if (payload.args != null && (typeof payload.args !== "object" || Array.isArray(payload.args))) {
    return Response.json({ error: "Invalid knowledge event arguments" }, { status: 400 });
  }
  const sender = payload.args?.sender;
  if (sender != null && (typeof sender !== "string" || !sender.trim() || sender.length > 128)) {
    return Response.json({ error: "Invalid knowledge sender" }, { status: 400 });
  }
  const event = publishAgentActivity(normalizeKnowledgeEvent(payload));
  return Response.json({ accepted: 1, eventId: event.eventId });
}
