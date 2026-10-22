// Server-side configuration only. Never import this module into client components.
export function loadKnowledgeConfig() {
  const baseUrl = process.env.KNOWLEDGE_BASE_URL?.trim().replace(/\/+$/, "");
  const searchUrl = process.env.KNOWLEDGE_SEARCH_URL?.trim();
  const apiKey = process.env.KNOWLEDGE_API_KEY?.trim();
  if (!baseUrl || !searchUrl || !apiKey) return null;
  return { baseUrl, searchUrl, apiKey };
}

export function loadKnowledgeAnswerConfig() {
  const answerUrl = process.env.KNOWLEDGE_ANSWER_URL?.trim();
  const apiKey = process.env.KNOWLEDGE_ANSWER_API_KEY?.trim();
  if (!answerUrl || !apiKey) return null;
  const configured = Number(process.env.KNOWLEDGE_ANSWER_TIMEOUT_MS || 350000);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 350000;
  return { answerUrl, apiKey, timeoutMs };
}
