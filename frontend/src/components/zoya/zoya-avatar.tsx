"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type ZoyaState = "idle" | "thinking" | "speaking";

/**
 * Zoya — the AI tutor's 2D character (original vector artwork). Animation is pure CSS so it costs nothing
 * at rest: she blinks, "thinks" (sparkles + mic glow, eyes up) while retrieving and talks while streaming.
 * Honours prefers-reduced-motion (see globals.css).
 */
export function ZoyaAvatar({
  size = 40,
  state = "idle",
  className,
  ring = false,
  title = "Zoya, your AI tutor",
}: {
  size?: number;
  state?: ZoyaState;
  className?: string;
  ring?: boolean;
  title?: string;
}) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `zoya-${raw}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  return (
    <span
      className={cn(
        "zoya relative inline-flex shrink-0 rounded-full",
        `zoya--${state}`,
        ring && "ring-2 ring-white shadow-[0_0_0_4px_rgb(59_130_246/0.18)]",
        className,
      )}
      style={{ width: size, height: size }}
      data-state={state}
    >
      <svg viewBox="0 0 240 240" width={size} height={size} role="img" aria-label={title} className="block">
        <title>{title}</title>
        <defs>
          <linearGradient id={id("bg")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b82f6" />
            <stop offset="0.55" stopColor="#2563eb" />
            <stop offset="1" stopColor="#4338ca" />
          </linearGradient>
          <radialGradient id={id("glow")} cx="0.5" cy="0.35" r="0.6">
            <stop offset="0" stopColor="#93c5fd" stopOpacity="0.45" />
            <stop offset="1" stopColor="#93c5fd" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id("hair")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3d2433" />
            <stop offset="1" stopColor="#241422" />
          </linearGradient>
          <linearGradient id={id("blazer")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1e3a8a" />
            <stop offset="1" stopColor="#162456" />
          </linearGradient>
          <linearGradient id={id("skin")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e4ad89" />
            <stop offset="1" stopColor="#dba07b" />
          </linearGradient>
          <clipPath id={id("circle")}>
            <circle cx="120" cy="120" r="120" />
          </clipPath>
        </defs>
        <g clipPath={url("circle")}>
          <rect width="240" height="240" fill={url("bg")} />
          <circle cx="120" cy="96" r="112" fill={url("glow")} />

          {/* hair (back) */}
          <path
            d="M120 34 C76 34 54 64 57 104 C59 128 51 146 55 162 C58 176 50 184 56 190 C66 198 84 190 98 180 L142 180 C156 190 174 198 184 190 C190 184 182 176 185 162 C189 146 181 128 183 104 C186 64 164 34 120 34 Z"
            fill={url("hair")}
          />

          {/* torso: navy blazer over a light-blue top */}
          <path d="M26 240 C28 196 62 176 101 166 L139 166 C178 176 212 196 214 240 Z" fill={url("blazer")} />
          <path d="M105 166 L120 198 L135 166 Q120 173 105 166 Z" fill="#dbeafe" />
          <path d="M105 166 L120 198 L112 202 L101 170 Z" fill="#bfdbfe" />
          <path d="M101 166 L120 206 L107 240 L86 240 L92 192 Z" fill="#14204d" />
          <path d="M139 166 L120 206 L133 240 L154 240 L148 192 Z" fill="#14204d" />
          <circle cx="120" cy="218" r="2.6" fill="#93c5fd" />

          {/* neck */}
          <path d="M105 124 L135 124 L137 166 Q120 175 103 166 Z" fill="#d69c78" />
          <path d="M105 132 Q120 150 135 132 L135 144 Q120 157 105 144 Z" fill="#c48965" />

          {/* ears */}
          <ellipse cx="78" cy="106" rx="6.5" ry="9.5" fill="#d69c78" />
          <ellipse cx="162" cy="106" rx="6.5" ry="9.5" fill="#d69c78" />

          {/* face */}
          <path
            d="M120 54 C149 54 163 76 163 102 C163 126 147 144 120 149 C93 144 77 126 77 102 C77 76 91 54 120 54 Z"
            fill={url("skin")}
          />

          {/* hair (front): side part with a swept fringe */}
          <path
            d="M78 104 C72 64 98 40 124 41 C152 42 170 66 164 104 C161 94 157 86 151 80 C141 84 128 80 118 70 C112 82 98 92 84 96 C81 99 79 101 78 104 Z"
            fill={url("hair")}
          />
          <path d="M151 80 C156 88 160 96 163 108 C166 124 164 138 156 150 C158 132 157 114 151 100 C149 92 150 86 151 80 Z" fill="#2c1828" />
          <path d="M84 96 C79 112 79 132 87 150 C85 132 86 116 91 102 Z" fill="#2c1828" />
          <path d="M96 56 C106 48 122 46 136 50" stroke="#6b4458" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.75" />
          <path d="M118 70 C124 76 134 81 146 81" stroke="#4a2c3d" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8" />

          {/* brows */}
          <g className="zoya-brows">
            <path d="M94 90 Q103 85 112 89" stroke="#3b2418" strokeWidth="2.8" fill="none" strokeLinecap="round" />
            <path d="M128 89 Q137 85 146 90" stroke="#3b2418" strokeWidth="2.8" fill="none" strokeLinecap="round" />
          </g>

          {/* eyes */}
          <g className="zoya-eyes">
            <g className="zoya-pupils">
              <ellipse cx="103.5" cy="103.5" rx="5.4" ry="7" fill="#2a1a14" />
              <circle cx="105.6" cy="100.6" r="1.9" fill="#fff" />
              <ellipse cx="136.5" cy="103.5" rx="5.4" ry="7" fill="#2a1a14" />
              <circle cx="138.6" cy="100.6" r="1.9" fill="#fff" />
            </g>
            <path d="M95.5 99.5 Q103.5 92.5 111.5 98.5" stroke="#1f130e" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M128.5 98.5 Q136.5 92.5 144.5 99.5" stroke="#1f130e" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </g>

          {/* cheeks */}
          <ellipse cx="96" cy="119" rx="7.5" ry="4.2" fill="#ff7d7d" opacity="0.28" />
          <ellipse cx="144" cy="119" rx="7.5" ry="4.2" fill="#ff7d7d" opacity="0.28" />

          {/* nose */}
          <path d="M120 107 Q116.5 116.5 121 119.5" stroke="#b77955" strokeWidth="2" fill="none" strokeLinecap="round" />

          {/* mouth: smile at rest, animated open shape while speaking */}
          <g className="zoya-smile">
            <path d="M107.5 126 Q120 139.5 132.5 126 Q120 131.5 107.5 126 Z" fill="#b83f4f" />
            <path d="M111 127.6 Q120 131.2 129 127.6 Q120 129.4 111 127.6 Z" fill="#fff" opacity="0.85" />
          </g>
          <g className="zoya-talk">
            <ellipse cx="120" cy="130" rx="9" ry="6.5" fill="#8f2d3b" />
            <path d="M112 127 Q120 124.5 128 127 Q120 128.6 112 127 Z" fill="#fff" opacity="0.85" />
            <ellipse cx="120" cy="133.4" rx="5" ry="2.4" fill="#e1717d" />
          </g>

          {/* headset */}
          <path d="M72 104 C68 52 172 52 168 104" stroke="#0b1226" strokeWidth="4.2" fill="none" strokeLinecap="round" />
          <rect x="66" y="96" width="16" height="22" rx="7" fill="#1e293b" />
          <rect x="66" y="96" width="16" height="22" rx="7" fill="none" stroke="#22d3ee" strokeWidth="1.4" />
          <path d="M78 116 C81 133 92 139 103.5 135.5" stroke="#1e293b" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <circle className="zoya-mic" cx="104.5" cy="135" r="3.3" fill="#67e8f9" />

          {/* sparkles */}
          <path className="zoya-sparkle zoya-sparkle-1" d="M179 38 L182 47 L191 50 L182 53 L179 62 L176 53 L167 50 L176 47 Z" fill="#fff" opacity="0.92" />
          <path className="zoya-sparkle zoya-sparkle-2" d="M196 72 L197.5 76.5 L202 78 L197.5 79.5 L196 84 L194.5 79.5 L190 78 L194.5 76.5 Z" fill="#a5f3fc" />
        </g>
      </svg>
      {state !== "idle" && (
        <span className="absolute -right-0.5 -bottom-0.5 flex size-[28%] min-h-2.5 min-w-2.5 items-center justify-center rounded-full bg-white">
          <span className={cn("size-[70%] rounded-full", state === "thinking" ? "animate-pulse bg-cyan-400" : "bg-emerald-500")} />
        </span>
      )}
    </span>
  );
}
