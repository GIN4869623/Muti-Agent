const DEFAULT_BASE_URLS = ["http://127.0.0.1:8000"];

export type AgentSdrIntegrationConfig = {
  baseUrls: string[];
};

let cachedBaseUrls: string[] | null = null;

export const normalizeAgentSdrBaseUrl = (value: string): string => {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Agent_SDR URL must use http or https.");
  }
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
};

const normalizeUrls = (urls: string[]): string[] =>
  [...new Set(urls.map((u) => normalizeAgentSdrBaseUrl(u)))];

const resolveBaseUrls = (): string[] => {
  // 1. AGENT_SDR_BASE_URLS（逗号分隔）
  const urlsEnv = process.env.AGENT_SDR_BASE_URLS?.trim();
  if (urlsEnv) {
    const urls = urlsEnv
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) return normalizeUrls(urls);
  }

  // 2. 向后兼容：AGENT_SDR_BASE_URL（单 URL）
  const singleEnv = process.env.AGENT_SDR_BASE_URL?.trim();
  if (singleEnv) return [normalizeAgentSdrBaseUrl(singleEnv)];

  // 3. 缓存
  if (cachedBaseUrls && cachedBaseUrls.length > 0) return cachedBaseUrls;

  // 4. 默认
  return DEFAULT_BASE_URLS;
};

export const loadAgentSdrConfig = (): AgentSdrIntegrationConfig => {
  const baseUrls = resolveBaseUrls();
  return { baseUrls };
};

export const saveAgentSdrConfig = (
  config: AgentSdrIntegrationConfig,
): AgentSdrIntegrationConfig => {
  const baseUrls = normalizeUrls(config.baseUrls);
  cachedBaseUrls = baseUrls;
  return { baseUrls };
};
