"use client";

import { useEffect, useState } from "react";
import type { AgentSdrActivityEvent, AgentSdrAgentSnapshot } from "@/lib/integrations/agent-sdr";
import { advanceKnowledgeActivity, consumeKnowledgeEvents, emptyKnowledgeActivity } from "@/lib/integrations/knowledge-activity";

type KnowledgeStatus = { connected: boolean; chunk_count: number | null; retrieval_method: string; embedding_model: string; checked_at: string };
const unavailable: KnowledgeStatus = { connected: false, chunk_count: null, retrieval_method: "--", embedding_model: "--", checked_at: "" };

export function useKnowledgeLive(events: AgentSdrActivityEvent[]) {
  const [status, setStatus] = useState<KnowledgeStatus>(unavailable);
  const [activity, setActivity] = useState(emptyKnowledgeActivity);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/integrations/knowledge/status", { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error("Unavailable");
        const next = await response.json() as KnowledgeStatus;
        if (!disposed) setStatus(next);
      } catch { if (!disposed) setStatus(unavailable); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => { setActivity((current) => consumeKnowledgeEvents(current, events, Date.now())); }, [events]);
  const busy = Object.keys(activity.runs).length > 0;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setActivity((current) => advanceKnowledgeActivity(current, Date.now())), 80);
    return () => window.clearInterval(timer);
  }, [busy]);
  const label = status.connected ? busy ? "检索中" : "空闲" : "未连接";
  const agent: AgentSdrAgentSnapshot = {
    id: "rag", connected: status.connected, working: status.connected && busy,
    status: label, task: label, location: "GraphRAG 知识库",
    metrics: [
      { label: "切片数量", value: status.chunk_count === null ? "--" : String(status.chunk_count) },
      { label: "检索方式", value: status.retrieval_method },
      { label: "检索模型", value: /^bge(?:-|$)/i.test(status.embedding_model) ? "BGE" : status.embedding_model },
    ],
  };
  return { agent, modelName: status.embedding_model, checkedAt: status.checked_at, lastError: activity.lastError,
    transfers: activity.transfers.filter((item) => item.startsAt <= activity.now && item.endsAt > activity.now) };
}
