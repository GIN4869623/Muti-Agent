"use client";

import { BookOpenCheck, MessageSquareText, Send } from "lucide-react";
import { KNOWLEDGE_CALLERS } from "@/lib/integrations/knowledge-routing";
import type { KnowledgeAnswerResult, KnowledgeModelProfile } from "@/lib/integrations/knowledge-answer";
import styles from "@/app/command-center/command-center.module.css";

type Props = {
  tab: "chat" | "content"; onTab: (tab: "chat" | "content") => void;
  question: string; onQuestion: (question: string) => void;
  sender: string; onSender: (sender: string) => void;
  modelProfile: KnowledgeModelProfile; onModelProfile: (profile: KnowledgeModelProfile) => void;
  result: KnowledgeAnswerResult | null; busy: boolean; error: string; onSubmit: () => void;
};

export function KnowledgeQueryContent({ tab, onTab, question, onQuestion, sender, onSender, modelProfile, onModelProfile, result, busy, error, onSubmit }: Props) {
  return <>
    <div className={styles.ragPanelTabs} role="tablist" aria-label="智能体交互面板">
      <button type="button" role="tab" id="knowledge-chat-tab" aria-selected={tab === "chat"}
        aria-controls="knowledge-chat-content" className={`${styles.ragPanelTab} ${tab === "chat" ? styles.ragPanelTabActive : ""}`}
        onClick={() => onTab("chat")}><MessageSquareText aria-hidden="true" />知识检索</button>
      <button type="button" role="tab" id="knowledge-content-tab" aria-selected={tab === "content"}
        aria-controls="knowledge-original-content" className={`${styles.ragPanelTab} ${tab === "content" ? styles.ragPanelTabActive : ""}`}
        onClick={() => onTab("content")}><BookOpenCheck aria-hidden="true" />返回内容{result ? <span className={styles.knowledgeResultCount}>{result.hits.length}</span> : null}</button>
    </div>
    <div className={styles.ragPanelBody} role="tabpanel" id={tab === "chat" ? "knowledge-chat-content" : "knowledge-original-content"}
      aria-labelledby={tab === "chat" ? "knowledge-chat-tab" : "knowledge-content-tab"}>
      {tab === "chat" ? <>
        <div className={`${styles.controlPanelHeader} ${styles.knowledgeSearchHeading}`}>
          <MessageSquareText aria-hidden="true" />
          <div><strong>知识智能体检索</strong><span>提交问题，获取回答</span></div>
        </div>
        <div className={styles.knowledgeQueryOptions}>
          <label className={styles.knowledgeSenderPicker}><span>发送方</span>
            <select aria-label="检索发送方" value={sender} disabled={busy} onChange={event => onSender(event.target.value)}>
              {KNOWLEDGE_CALLERS.map(caller => <option key={caller.id} value={caller.name}>{caller.name}</option>)}
            </select>
          </label>
          <label className={styles.knowledgeSenderPicker}><span>回答模型</span>
            <select aria-label="回答模型" value={modelProfile} disabled={busy}
              onChange={event => onModelProfile(event.target.value as KnowledgeModelProfile)}>
              <option value="local">本地模型</option>
              <option value="cloud">云端模型</option>
            </select>
          </label>
        </div>
        <textarea className={styles.controlTextarea} aria-label="检索问题" value={question} maxLength={2000}
          onChange={event => onQuestion(event.target.value)} rows={4} />
        <button className={styles.actionButton} type="button" disabled={busy || !question.trim()} onClick={onSubmit}>
          <Send aria-hidden="true" />{busy ? "生成回答中…" : "提交检索"}
        </button>
        {error ? <div className={styles.knowledgeQueryError} role="alert">{error}</div> : null}
        {result ? <section className={styles.knowledgeAnswer} aria-label="知识库回答">
          <div className={styles.knowledgeAnswerHeading}><strong>{result.llm_used ? "大模型回答" : "知识库提示"}</strong>
            <span title={result.model ?? undefined}>{result.llm_used && result.model_profile ? `${result.model_profile === "cloud" ? "云端" : "本地"} · ` : ""}{result.model || "依据不足"}</span></div>
          <p className={styles.knowledgeResultQuestion}>本次问题：{result.question}</p>
          <div className={styles.knowledgeAnswerText}>{result.answer}</div>
        </section> : null}
      </> : <>
        <div className={styles.knowledgeContentHeading}><strong>切片原文</strong><span>{result ? `${result.hits.length} 条` : "等待检索"}</span></div>
        {busy ? <p className={styles.knowledgeEmpty}>正在生成回答，依据切片会随结果一起返回。</p>
          : error ? <div className={styles.knowledgeQueryError} role="alert">{error}</div>
          : !result ? <p className={styles.knowledgeEmpty}>在“知识检索”提交问题后，这里显示本次回答依据的切片原文。</p>
          : result.hits.length === 0 ? <p className={styles.knowledgeEmpty}>本次没有返回文档切片；回答中如有图谱或状态依据，会直接体现在“知识检索”页的回答里。</p>
          : <><p className={styles.knowledgeResultQuestion}>本次问题：{result.question}</p>
            {result.hits.map((hit, index) => <details key={`${result.request_id}-${hit.chunk_id}-${index}`} className={styles.knowledgeChunk} open={index === 0}>
              <summary><span>{hit.rank}</span><strong>{hit.title || "未命名文档"}</strong></summary>
              <div className={styles.knowledgeChunkMeta}>{hit.section_path?.join(" / ") || hit.section || "正文"} · 得分 {hit.score.toFixed(3)}</div>
              <pre className={styles.knowledgeChunkText}>{hit.text}</pre>
            </details>)}
          </>}
      </>}
    </div>
  </>;
}
