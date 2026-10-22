export type KnowledgeModelProfile = "local" | "cloud";

export type KnowledgeAnswerHit = {
  rank: number; chunk_id: string; document_id: string; text: string;
  title?: string | null; section?: string | null; section_path?: string[]; score: number;
};
export type KnowledgeAnswerResult = {
  request_id: string; sender: string; question: string; answer: string;
  status: "success" | "failed" | "answered" | "insufficient_evidence"; llm_used: boolean;
  model?: string | null; model_profile?: KnowledgeModelProfile; hits: KnowledgeAnswerHit[];
};

export function parseKnowledgeAnswer(value: unknown): KnowledgeAnswerResult {
  if (!value || typeof value !== "object") throw new Error("问答接口返回格式不正确");
  const result = value as Record<string, unknown>;
  if (typeof result.answer !== "string" || typeof result.question !== "string" ||
      typeof result.request_id !== "string" || typeof result.llm_used !== "boolean" ||
      !["success", "failed", "answered", "insufficient_evidence"].includes(String(result.status)) || !Array.isArray(result.hits)) {
    throw new Error("问答接口返回格式不正确");
  }
  if (result.hits.some((hit) => !hit || typeof hit !== "object" || typeof hit.text !== "string" ||
      typeof hit.chunk_id !== "string" || typeof hit.document_id !== "string" ||
      typeof hit.rank !== "number" || typeof hit.score !== "number")) {
    throw new Error("问答接口没有返回完整的切片原文");
  }
  return result as KnowledgeAnswerResult;
}
