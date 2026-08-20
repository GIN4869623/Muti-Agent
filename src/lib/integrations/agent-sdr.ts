export type AgentSdrId = string;

export type AgentSdrPhase =
  | "idle"
  | "received"
  | "routing"
  | "started"
  | "tool_started"
  | "streaming"
  | "tool_completed"
  | "completed"
  | "failed";

export type AgentSdrAgentSnapshot = {
  id: AgentSdrId;
  connected: boolean;
  working: boolean;
  status: string;
  task: string;
  location: string;
  metrics: Array<{ label: string; value: string }>;
};

export type AgentSdrStatusSnapshot = {
  connected: boolean;
  checkedAt: string;
  baseUrls: string[];
  eventStreamAvailable: boolean | null;
  error: string | null;
  agents: Record<string, AgentSdrAgentSnapshot>;
};

export type AgentSdrActivityEvent = {
  schemaVersion?: number;
  eventId?: string;
  timestamp?: string;
  type: "agent.activity";
  runId?: string;
  sessionId?: string;
  agentId: AgentSdrId;
  sourceAgentId?: AgentSdrId;
  targetAgentId?: AgentSdrId;
  parentRunId?: string;
  phase: AgentSdrPhase;
  request?: string;
  task?: string;
  detail?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  durationMs?: number;
  delivery?: "live" | "replay";
  clientReceivedAt?: number;
};

export const isAgentSdrActivityEvent = (value: unknown): value is AgentSdrActivityEvent => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "agent.activity" &&
    typeof record.agentId === "string" &&
    typeof record.phase === "string"
  );
};
