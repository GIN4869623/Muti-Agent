const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

export type AgentSdrIntegrationConfig = {
  baseUrl: string;
};

let cachedBaseUrl: string | null = null;

export const normalizeAgentSdrBaseUrl = (value: string): string => {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Agent_SDR URL must use http or https.");
  }
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
};

export const loadAgentSdrConfig = (): AgentSdrIntegrationConfig => {
  const envUrl = process.env.AGENT_SDR_BASE_URL?.trim();
  const baseUrl = cachedBaseUrl || envUrl || DEFAULT_BASE_URL;
  return { baseUrl: normalizeAgentSdrBaseUrl(baseUrl) };
};

export const saveAgentSdrConfig = (
  config: AgentSdrIntegrationConfig,
): AgentSdrIntegrationConfig => {
  const normalized = { baseUrl: normalizeAgentSdrBaseUrl(config.baseUrl) };
  cachedBaseUrl = normalized.baseUrl;
  return normalized;
};
