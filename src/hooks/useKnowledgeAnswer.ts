"use client";

import { useEffect, useRef, useState } from "react";
import { parseKnowledgeAnswer, type KnowledgeAnswerResult, type KnowledgeModelProfile } from "@/lib/integrations/knowledge-answer";

export function useKnowledgeAnswer() {
  const [result, setResult] = useState<KnowledgeAnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const submit = async (question: string, sender: string, modelProfile: KnowledgeModelProfile = "local") => {
    if (!question.trim() || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/integrations/knowledge/answer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, question: question.trim(), top_k: 5, model_profile: modelProfile }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "问答请求失败，请稍后重试");
      if (!controller.signal.aborted) setResult(parseKnowledgeAnswer(data));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "问答请求失败，请稍后重试");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const status = busy ? "正在检索并生成回答…" : error || (result
    ? `${result.llm_used ? "回答已返回" : "已返回知识库提示"} · ${result.hits.length} 条切片`
    : "输入问题，获取回答与依据切片");
  return { result, busy, error, status, submit };
}
