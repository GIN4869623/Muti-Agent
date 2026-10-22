import type { AgentSdrActivityEvent } from "./agent-sdr";

export type KnowledgePeer = { id: string; name: string; shortName: string };
type KnowledgeCaller = KnowledgePeer & {
  aliases: readonly string[];
  link: { request: string; response: string } | null;
};

// A direct query has no visual agent link; the other callers keep their own routes.
export const KNOWLEDGE_CALLERS: readonly KnowledgeCaller[] = [
  { id: "direct", name: "普通检索", shortName: "检索", aliases: ["普通检索"], link: null },
  {
    id: "supervisor", name: "编排智能体", shortName: "编排",
    aliases: ["编排智能体", "协同编排智能体", "supervisor"],
    link: { request: "M57 114 Q72 82 78 52", response: "M78 52 Q72 82 57 114" },
  },
  {
    id: "usrp", name: "网络监管智能体", shortName: "网络监管",
    aliases: ["网络监管智能体", "usrp"],
    link: { request: "M22 50 Q50 14 78 50", response: "M78 50 Q50 14 22 50" },
  },
];

export function resolveKnowledgeSender(sender: unknown): KnowledgePeer {
  const name = typeof sender === "string" ? sender.trim().slice(0, 128) : "";
  const caller = KNOWLEDGE_CALLERS.find((item) => item.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()));
  return caller ? { id: caller.id, name: caller.name, shortName: caller.shortName }
    : { id: "external", name: name || "外部调用方", shortName: "外部" };
}

export function getKnowledgeLink(peerId: string) {
  return KNOWLEDGE_CALLERS.find((item) => item.id === peerId)?.link ?? null;
}

export function normalizeKnowledgeEvent(event: AgentSdrActivityEvent): AgentSdrActivityEvent {
  const peer = resolveKnowledgeSender(event.args?.sender);
  const outgoing = event.phase === "completed" || event.phase === "failed";
  return {
    ...event,
    sourceAgentId: outgoing ? "rag" : peer.id,
    targetAgentId: outgoing ? peer.id : "rag",
    args: { ...event.args, sender: typeof event.args?.sender === "string" ? event.args.sender.trim() : "外部调用方" },
  };
}

export function knowledgePeerForEvent(event: AgentSdrActivityEvent): KnowledgePeer {
  const outgoing = event.phase === "completed" || event.phase === "failed";
  const peerId = outgoing ? event.targetAgentId : event.sourceAgentId;
  const caller = KNOWLEDGE_CALLERS.find((item) => item.id === peerId);
  if (caller) return { id: caller.id, name: caller.name, shortName: caller.shortName };
  if (peerId === "external") return { id: "external", name: resolveKnowledgeSender(event.args?.sender).name, shortName: "外部" };
  return resolveKnowledgeSender(event.args?.sender);
}
