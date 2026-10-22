"use client";

import { useEffect, useRef, useState } from "react";
import { TRANSFER_MS, type KnowledgeTransfer as Transfer } from "@/lib/integrations/knowledge-activity";
import { getKnowledgeLink } from "@/lib/integrations/knowledge-routing";
import styles from "./knowledge-transfer.module.css";

export function KnowledgeTransfer({ transfer }: { transfer: Transfer }) {
  const anchor = useRef<SVGGElement>(null);
  const motion = useRef<SVGAnimateMotionElement>(null);
  const [pixelScale, setPixelScale] = useState<{ x: number; y: number } | null>(null);
  const sending = transfer.direction === "request";
  const link = getKnowledgeLink(transfer.peer.id);
  const path = link?.[transfer.direction];
  const source = sending ? transfer.peer.shortName : "知识";
  const target = sending ? "知识" : transfer.peer.shortName;

  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement;
    if (!svg) return;
    // The parent SVG stretches independently on both axes. Undo that stretch
    // for the dot and bubble so the text stays crisp and the dot stays circular.
    const resize = () => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = svg.viewBox.baseVal.width / rect.width;
      const y = svg.viewBox.baseVal.height / rect.height;
      setPixelScale((current) => current?.x === x && current?.y === y ? current : { x, y });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(svg);
    motion.current?.beginElement();
    return () => observer.disconnect();
  }, []);

  if (!path) return null;

  return (
    <g ref={anchor} className={styles.transfer} data-knowledge-direction={transfer.direction}
      data-knowledge-run={transfer.runId} data-knowledge-peer={transfer.peer.id}
      data-knowledge-source={sending ? transfer.peer.id : "rag"} data-knowledge-target={sending ? "rag" : transfer.peer.id}
      role="img" aria-label={`${sending ? "发送问题" : "返回结果"}：${source}到${target}`}>
      <animateMotion ref={motion} begin="indefinite" dur={`${TRANSFER_MS}ms`} repeatCount="1" fill="freeze"
        path={path} calcMode="spline" keyTimes="0;1" keySplines="0.25 0.1 0.25 1" />
      {pixelScale ? (
        <g transform={`scale(${pixelScale.x} ${pixelScale.y})`}>
          <foreignObject x="-154" y="-27" width="144" height="60" overflow="visible">
            <div className={styles.bubble} data-knowledge-bubble={transfer.direction}>
              <span className={styles.icon} aria-hidden="true">{sending ? "↗" : "↙"}</span>
              <div className={styles.copy}>
                <span className={styles.title}>{sending ? "发送问题" : "返回结果"}</span>
                <span className={styles.subtitle}>{`${source} → ${target}`}</span>
              </div>
            </div>
          </foreignObject>
          <circle className={styles.halo} r="11" />
          <circle className={styles.dot} r="5" />
          <circle className={styles.core} r="2" />
        </g>
      ) : null}
    </g>
  );
}
