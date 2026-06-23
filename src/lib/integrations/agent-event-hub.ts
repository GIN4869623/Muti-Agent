import { randomUUID } from "node:crypto";

import type { AgentSdrActivityEvent } from "@/lib/integrations/agent-sdr";

type ActivityListener = (event: AgentSdrActivityEvent) => void;

type AgentEventHub = {
  recent: AgentSdrActivityEvent[];
  listeners: Set<ActivityListener>;
};

const GLOBAL_KEY = "__claw3dAgentEventHub";
const MAX_RECENT_EVENTS = 100;

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: AgentEventHub;
};

const getHub = (): AgentEventHub => {
  globalState[GLOBAL_KEY] ??= {
    recent: [],
    listeners: new Set(),
  };
  return globalState[GLOBAL_KEY];
};

export const publishAgentActivity = (
  event: AgentSdrActivityEvent,
): AgentSdrActivityEvent => {
  const normalized: AgentSdrActivityEvent = {
    ...event,
    schemaVersion: event.schemaVersion ?? 1,
    eventId: event.eventId?.trim() || randomUUID(),
    timestamp: event.timestamp?.trim() || new Date().toISOString(),
  };
  const hub = getHub();
  hub.recent = [normalized, ...hub.recent].slice(0, MAX_RECENT_EVENTS);
  for (const listener of hub.listeners) {
    listener(normalized);
  }
  return normalized;
};

export const subscribeToAgentActivity = (listener: ActivityListener): (() => void) => {
  const hub = getHub();
  hub.listeners.add(listener);
  return () => hub.listeners.delete(listener);
};

export const listRecentAgentActivity = (): AgentSdrActivityEvent[] => [
  ...getHub().recent,
];
