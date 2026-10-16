"use client";

import { useEffect, useRef, useState } from "react";
import { grapeLayout } from "./grape-layout.mjs";

export default function GrapeCluster({ target, filled, state = "idle", onNext }: {
  target: number; filled: number; state?: "idle" | "saving" | "success"; onNext?: () => void;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(280);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = grapeLayout(target, width);
  const d = layout.diameter;
  const count = Math.max(0, Math.min(target, filled));
  return <span className="grape-container" ref={container}>
    <svg className={`grape-cluster grape-${state}`} width={layout.width} height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`포도판, ${target}알 중 ${count}알 기록`}>
      <title>{`포도판, ${target}알 중 ${count}알 기록`}</title>
      <rect x={layout.width / 2 - d * .07} y={d * .05} width={d * .14} height={d * .95} rx={d * .07} className="grape-stem" />
      <path d={`M ${layout.width / 2 + d * .08} ${d * .2} q ${d * .75} ${-d * .28} ${d} ${d * .4} q ${-d * .75} ${d * .28} ${-d} ${-d * .4}`}
        transform={`rotate(-14 ${layout.width / 2} ${d * .3})`} className="grape-leaf" />
      {layout.units.map((unit) => {
        const next = unit.index === count && state !== "saving" && onNext;
        const geometry = { cx: unit.x + d / 2, cy: unit.y + d / 2, r: d * .46,
          className: `grape-unit ${unit.index < count ? "filled" : "empty"} ${next ? "next" : ""}`, strokeWidth: Math.max(1, d * .045) };
        return <g key={unit.index} className={state === "success" && unit.index === count - 1 ? "grape-just-saved" : undefined}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Pointer-only shortcut inside role=img; the full-width native button below is the keyboard and assistive control. */}
          <circle {...geometry} tabIndex={-1} onClick={next ? onNext : undefined} />
          {unit.index < count && <circle cx={unit.x + d * .33} cy={unit.y + d * .3} r={d * .1} fill="#fff" pointerEvents="none" />}
          {state === "success" && unit.index === count - 1 && <circle className="grape-success-ring" cx={unit.x + d / 2} cy={unit.y + d / 2} r={d * .52} strokeWidth={d * .055} pointerEvents="none" />}
        </g>;
      })}
    </svg>
  </span>;
}
