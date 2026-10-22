import type { AgentSdrActivityEvent } from "./agent-sdr";
import { knowledgePeerForEvent, type KnowledgePeer } from "./knowledge-routing";

export const KNOWLEDGE_TOOL = "shared_knowledge_search";
export const KNOWLEDGE_ANSWER_TOOL = "knowledge_answer";
export const isKnowledgeActivityTool = (tool: string | undefined) => tool === KNOWLEDGE_TOOL || tool === KNOWLEDGE_ANSWER_TOOL;
export const TRANSFER_MS = 3200;
export const TRANSFER_GAP_MS = 180;
const REQUEST_TIMEOUT_MS = 125_000;
export type KnowledgeTransfer = { id: string; runId: string; direction: "request" | "response"; peer: KnowledgePeer; startsAt: number; endsAt: number };
type Run = { peer: KnowledgePeer; requestEndsAt: number; expiresAt: number; finished: boolean };
export type KnowledgeActivity = { now: number; seen: string[]; runs: Record<string, Run>; transfers: KnowledgeTransfer[]; lastError: boolean };
export const emptyKnowledgeActivity = (): KnowledgeActivity => ({ now: 0, seen: [], runs: {}, transfers: [], lastError: false });

export function advanceKnowledgeActivity(state: KnowledgeActivity, now: number): KnowledgeActivity {
  return { ...state, now, runs: Object.fromEntries(Object.entries(state.runs).filter(([, run]) => run.expiresAt > now)),
    transfers: state.transfers.filter((item) => item.endsAt > now) };
}

export function consumeKnowledgeEvents(state: KnowledgeActivity, events: AgentSdrActivityEvent[], now: number): KnowledgeActivity {
  const next = advanceKnowledgeActivity(state, now);
  next.runs = { ...next.runs };
  next.seen = [...next.seen];
  next.transfers = [...next.transfers];
  for (const event of [...events].reverse()) {
    if (event.delivery !== "live" || !isKnowledgeActivityTool(event.toolName) || !event.runId) continue;
    const key = event.eventId ?? `${event.runId}:${event.phase}`;
    if (next.seen.includes(key)) continue;
    next.seen.push(key);
    const timeout = event.toolName === KNOWLEDGE_ANSWER_TOOL ? 355_000 : REQUEST_TIMEOUT_MS;
    if (event.clientReceivedAt && now - event.clientReceivedAt > timeout) continue;
    const runId = event.runId;
    const run = next.runs[runId];
    const peer = run?.peer ?? knowledgePeerForEvent(event);
    if (event.phase === "received") {
      if (run) continue;
      next.lastError = false;
      next.runs[runId] = { peer, requestEndsAt: peer.id === "direct" ? now : now + TRANSFER_MS, expiresAt: now + timeout, finished: false };
      if (peer.id !== "direct") next.transfers.push({ id: key, runId, peer, direction: "request", startsAt: now, endsAt: now + TRANSFER_MS });
    } else if (event.phase === "completed") {
      if (run?.finished) continue;
      if (peer.id === "direct") { delete next.runs[runId]; continue; }
      const startsAt = Math.max(now, (run?.requestEndsAt ?? now) + (run ? TRANSFER_GAP_MS : 0));
      next.runs[runId] = { peer, requestEndsAt: run?.requestEndsAt ?? now, expiresAt: startsAt + TRANSFER_MS, finished: true };
      next.transfers.push({ id: key, runId, peer, direction: "response", startsAt, endsAt: startsAt + TRANSFER_MS });
    } else if (event.phase === "failed") {
      delete next.runs[runId];
      next.transfers = next.transfers.filter((item) => item.runId !== runId);
      next.lastError = true;
    }
  }
  next.seen = next.seen.slice(-256);
  next.transfers = next.transfers.slice(-128);
  return next;
}
