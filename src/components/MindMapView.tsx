import { useEffect, useMemo, useState, useRef } from "react";
import { BookOpen, Layers, CheckCircle2, ChevronDown, ChevronRight, List, Share2, ZoomIn, ZoomOut, RotateCcw, Move } from "lucide-react";

/**
 * MindMapView — interactive radial mind map for a lecture's sections/notes.
 * Premium One-Frame Edition with Interactive Pan & Zoom Canvas + Zero-Clipping Bounds.
 */

const NAVY = "#1E2761";
const ACCENT = "#4A90D9";
const BRANCH_COLORS = ["#4A90D9", "#7B5EA7", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];
const FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ── Ultra-Wide Coordinate Space (1080 x 780) — Guarantees subtopics NEVER clip left or right edges ──
const VB_W = 1080;
const VB_H = 780;
const CENTER_X = VB_W / 2;      // 540
const CENTER_Y = VB_H / 2;      // 390
const BRANCH_RADIUS = 155;      // Distance from center to each topic bubble
const LEAF_RADIUS_BASE = 150;   // Generous distance so subtopics never hide behind bubbles

export type MindMapSection = { title: string; notes: string[] };
export interface MindMapViewProps {
  title: string;
  sections: MindMapSection[];
}

type BranchNode = {
  title: string;
  notes: string[];
  angle: number;
  x: number;
  y: number;
  color: string;
  stepNumber: number;
};

/**
 * Formats Topic Titles: Allows up to 6 words so titles like
 * "Supervised vs Unsupervised Learning" display completely across lines.
 */
function topicLabel(text: string): string {
  const clean = (text || "").trim();
  if (!clean) return "Topic";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return words.join(" ");
  
  const sliced = words.slice(0, 6);
  const dangling = ["vs", "vs.", "and", "or", "the", "of", "to", "in", "for", "with", "on", "&"];
  while (sliced.length > 2 && dangling.includes(sliced[sliced.length - 1].toLowerCase())) {
    sliced.pop();
  }
  return sliced.join(" ") + "…";
}

/**
 * Converts strings to clean Title Case for subtopic buttons
 * (e.g., "structured data" -> "Structured Data").
 */
function toTitleCase(str: string): string {
  const stopWords = new Set(["a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"]);
  return str
    .split(/\s+/)
    .map((word, index) => {
      const w = word.toLowerCase();
      if (index > 0 && stopWords.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/**
 * Subtopic Extractor:
 * Transforms a full academic sentence into a clean 1-4 word Subtopic Heading
 * without trailing ellipses (...) or chopped-off verbs.
 */
function extractSubtopic(text: string, idx: number): string {
  let clean = (text || "").trim();
  if (!clean) return `Point #${idx + 1}`;

  // 1. Safely remove Markdown bold markers and bullets without eating letters (\-)
  clean = clean.replace(/\*\*/g, "").replace(/^[*\-•]+\s*/, "").trim();

  // 2. Remove introductory academic filler phrases
  const fillers = [
    /^In contrast,?\s+/i,
    /^In addition,?\s+/i,
    /^Furthermore,?\s+/i,
    /^Moreover,?\s+/i,
    /^However,?\s+/i,
    /^For example,?\s+/i,
    /^For instance,?\s+/i,
    /^Therefore,?\s+/i,
    /^Thus,?\s+/i,
    /^As a result,?\s+/i,
    /^Once trained,?\s+/i,
    /^After preprocessing,?\s+/i,
    /^This predictive capability,?\s+/i,
    /^This means that\s+/i,
    /^It is important to note that\s+/i,
    /^Basically,?\s+/i,
    /^Overall,?\s+/i,
  ];
  for (const f of fillers) {
    clean = clean.replace(f, "");
  }

  // 3. Check for explicit prefix delimiters: Colon (:), Em-dash (—), En-dash (–), or Hyphen (-)
  const delimiterMatch = clean.match(/^([^:—–]{2,36})(?::|—|–|\s-\s)/);
  if (delimiterMatch && delimiterMatch[1]) {
    const prefix = delimiterMatch[1].trim();
    if (prefix.split(/\s+/).length <= 6) {
      const res = toTitleCase(prefix).trim();
      if (res) return res;
    }
  }

  // 4. Extract the subject Noun Phrase before common linking/action verbs
  const verbRegex = /\s+(?:is|are|was|were|refers|involves|lacks|represents|can|will|consists|contains|helps|provides|means|enables|serves|has|have|requires|functions|acts|differs|possesses|uses|utilizes|relies|focuses)\b/i;
  const verbSplit = clean.split(verbRegex);
  if (verbSplit.length > 1 && verbSplit[0].trim().length >= 3) {
    const subject = verbSplit[0].split(",")[0].trim();
    const words = subject.split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 5) {
      const res = toTitleCase(subject).trim();
      if (res) return res;
    }
  }

  // 5. Fallback: Take the first 4 noun words cleanly (NO ellipses "...")
  const words = clean.replace(/[,.?!;:]+$/, "").split(/\s+/).filter(Boolean);
  const subtopicWords = words.slice(0, Math.min(4, words.length));
  const finalPhrase = subtopicWords.join(" ").replace(/[,.?!;:]+$/, "");
  const res = toTitleCase(finalPhrase).trim();
  return res || `Point #${idx + 1}`;
}

/** Safely coerce whatever daily_notes.sections_content holds into MindMapSection[]. */
export function normalizeSectionsForMindMap(raw: unknown): MindMapSection[] {
  let val: unknown = raw;
  if (typeof val === "string") {
    try { val = JSON.parse(val); } catch { return []; }
  }
  if (!Array.isArray(val)) return [];
  return (val as unknown[])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      title: String((s.title as string) || "Untitled"),
      notes: Array.isArray(s.notes) ? (s.notes as unknown[]).map(String) : [],
    }))
    .filter((s) => s.notes.length > 0);
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Calculates Quadrant-Aware Outward Card Coordinates:
 * Positions 180x52 cards safely outward so they never overlap bubbles or canvas edges.
 */
function getLeafCardPos(cx: number, cy: number, r: number, deg: number, cardWidth = 180, cardHeight = 52) {
  const rad = ((deg - 90) * Math.PI) / 180;
  const dotX = cx + r * Math.cos(rad);
  const dotY = cy + r * Math.sin(rad);

  const normalizedDeg = ((deg % 360) + 360) % 360;
  const isRightSide = normalizedDeg >= 0 && normalizedDeg <= 180;

  const gap = 16;
  const boxX = isRightSide ? dotX + gap : dotX - cardWidth - gap;
  const boxY = dotY - cardHeight / 2 + Math.sin(rad) * 12;

  return {
    dotX,
    dotY,
    boxX,
    boxY,
  };
}

export function MindMapView({ title, sections }: MindMapViewProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ section: number; note: number } | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");
  const detailRef = useRef<HTMLDivElement>(null);

  // ── Pan & Zoom State ──
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // New lecture loaded → reset state & canvas view
  useEffect(() => {
    setExpanded(null);
    setSelected(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [sections]);

  // Arrange branches in clockwise order starting at 30° (top-right 1 o'clock reading order)
  const branches: BranchNode[] = useMemo(() => {
    const n = sections.length || 1;
    return sections.map((sec, i) => {
      const angle = 30 + (360 / n) * i;
      const pos = polar(CENTER_X, CENTER_Y, BRANCH_RADIUS, angle);
      return {
        title: sec.title,
        notes: sec.notes,
        angle,
        x: pos.x,
        y: pos.y,
        color: BRANCH_COLORS[i % BRANCH_COLORS.length],
        stepNumber: i + 1, // Reading order sequence: 1, 2, 3...
      };
    });
  }, [sections]);

  const activeBranch = expanded !== null ? branches[expanded] ?? null : null;

  const leaves = useMemo(() => {
    if (!activeBranch) return [];
    const count = activeBranch.notes.length;
    const leafRadius = LEAF_RADIUS_BASE + Math.max(0, count - 5) * 8;
    
    // Wide angular spacing (min 80° apart) so cards never collide
    const spread = count > 1 ? Math.min(175, Math.max(80, (count - 1) * 45)) : 0;
    const start = activeBranch.angle - spread / 2;
    const step = count > 1 ? spread / (count - 1) : 0;
    
    return activeBranch.notes.map((note, i) => {
      const angle = count === 1 ? activeBranch.angle : start + step * i;
      const pos = getLeafCardPos(activeBranch.x, activeBranch.y, leafRadius, angle, 180, 52);
      return { note, ...pos, idx: i, noteNumber: i + 1 };
    });
  }, [activeBranch]);

  // ── Mouse / Touch Pan & Zoom Handlers ──
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(Math.max(prev * zoomFactor, 0.6), 2.2));
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPan({
      x: e.touches[0].clientX - dragStartRef.current.x,
      y: e.touches[0].clientY - dragStartRef.current.y,
    });
  };

  const handleTouchEnd = () => setIsDragging(false);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (sections.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 1.5rem", color: "#94a3b8", fontSize: 15, fontFamily: FONT_STACK }}>
        No topic breakdown available for this lecture yet.
      </div>
    );
  }

  const selectedBranch = selected ? branches[selected.section] ?? null : null;
  const selectedNoteText = selected && selectedBranch ? selectedBranch.notes[selected.note] ?? null : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: FONT_STACK,
        background: "#ffffff",
        borderRadius: 24,
        border: "1px solid #e2e8f4",
        boxShadow: "0 10px 36px rgba(30, 39, 97, 0.06)",
        overflow: "hidden",
        padding: "16px",
      }}
    >
      {/* Top Header Bar — Guidance badge & View Mode Toggle (Radial Graph vs List) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>
            Interactive Lecture Map
          </span>
          <div
            style={{
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 11.5,
              fontWeight: 600,
              color: "#475569",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Layers style={{ width: 13, height: 13, color: ACCENT }} />
            <span>Clockwise (1 → {branches.length})</span>
          </div>
        </div>

        {/* View Mode Switcher (Ensures mobile users can toggle between Map and List freely) */}
        <div style={{ display: "flex", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 2 }}>
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              color: viewMode === "graph" ? NAVY : "#64748b",
              background: viewMode === "graph" ? "white" : "transparent",
              boxShadow: viewMode === "graph" ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <Share2 style={{ width: 13, height: 13 }} />
            <span>Map</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              color: viewMode === "list" ? NAVY : "#64748b",
              background: viewMode === "list" ? "white" : "transparent",
              boxShadow: viewMode === "list" ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <List style={{ width: 13, height: 13 }} />
            <span>List</span>
          </button>
        </div>
      </div>

      {viewMode === "graph" ? (
        <>
          {/* Visual Canvas Container — Interactive Drag-to-Pan & Scroll-to-Zoom enabled */}
          <div
            style={{
              position: "relative",
              width: "100%",
              minHeight: 360,
              maxHeight: "min(480px, 52vh)",
              margin: "0 auto",
              background: "radial-gradient(circle at 50% 50%, #ffffff 0%, #f3f6fc 100%)",
              borderRadius: 18,
              border: "1px solid #e8edf8",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isDragging ? "grabbing" : "grab",
              userSelect: "none",
            }}
          >
            {/* Top-Left Drag Hint Badge */}
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                background: "rgba(255, 255, 255, 0.85)",
                backdropFilter: "blur(6px)",
                border: "1px solid #e2e8f0",
                padding: "4px 10px",
                borderRadius: 14,
                fontSize: 11,
                fontWeight: 600,
                color: "#64748b",
                display: "flex",
                alignItems: "center",
                gap: 5,
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <Move style={{ width: 12, height: 12, color: ACCENT }} />
              <span>Drag canvas to pan · Scroll to zoom</span>
            </div>

            {/* Bottom-Right Floating Zoom Controls Toolbar */}
            <div
              style={{
                position: "absolute",
                bottom: 14,
                right: 14,
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "rgba(255, 255, 255, 0.94)",
                backdropFilter: "blur(8px)",
                border: "1px solid #cbd5e1",
                padding: "4px",
                borderRadius: 12,
                boxShadow: "0 4px 14px rgba(30, 39, 97, 0.1)",
                zIndex: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.min(prev + 0.2, 2.2))}
                title="Zoom In"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  color: NAVY,
                }}
              >
                <ZoomIn style={{ width: 16, height: 16 }} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(prev - 0.2, 0.6))}
                title="Zoom Out"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  color: NAVY,
                }}
              >
                <ZoomOut style={{ width: 16, height: 16 }} />
              </button>
              <div style={{ width: 1, height: 16, background: "#cbd5e1", margin: "0 2px" }} />
              <button
                type="button"
                onClick={resetView}
                title="Reset View"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  color: NAVY,
                }}
              >
                <RotateCcw style={{ width: 15, height: 15 }} />
              </button>
            </div>

            {/* Interactive SVG Canvas */}
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              style={{ width: "100%", height: "100%", maxHeight: "100%", display: "block" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* SVG DEFS — Drop Shadows & 3D Lighting Gradients */}
              <defs>
                <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#1E2761" floodOpacity="0.14" />
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1E2761" floodOpacity="0.08" />
                </filter>

                {/* Premium Center Aura Glow */}
                <radialGradient id="center-grad" cx="35%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="#2D3B8E" />
                  <stop offset="100%" stopColor="#131B4D" />
                </radialGradient>

                {/* Spherical lighting gradients for each branch color */}
                {BRANCH_COLORS.map((color, idx) => (
                  <radialGradient key={`grad-${idx}`} id={`branch-grad-${idx}`} cx="35%" cy="30%" r="75%">
                    <stop offset="0%" stopColor={color} stopOpacity="0.85" />
                    <stop offset="100%" stopColor={color} stopOpacity="1" />
                  </radialGradient>
                ))}
              </defs>

              {/* Master Viewport Transform Group for Drag Panning & Zooming */}
              <g
                transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
                style={{
                  transformOrigin: `${CENTER_X}px ${CENTER_Y}px`,
                  transition: isDragging ? "none" : "transform 0.15s ease-out",
                }}
              >
                {/* Background Decorative Rings */}
                <circle cx={CENTER_X} cy={CENTER_Y} r={BRANCH_RADIUS} fill="none" stroke="#e8edf8" strokeWidth={1.5} strokeDasharray="6 6" />
                <circle cx={CENTER_X} cy={CENTER_Y} r={80} fill="none" stroke="rgba(74, 144, 217, 0.12)" strokeWidth={14} />

                {/* Center → Topic Edges */}
                {branches.map((b, i) => {
                  const isOpen = expanded === i;
                  return (
                    <g key={`edge-group-${i}`}>
                      <line
                        x1={CENTER_X} y1={CENTER_Y} x2={b.x} y2={b.y}
                        stroke={isOpen ? b.color : "#cdd7e8"}
                        strokeWidth={isOpen ? 3.5 : 2}
                        strokeLinecap="round"
                        style={{ transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}
                      />
                    </g>
                  );
                })}

                {/* Topic → Note Edges (Only for open topic) */}
                {activeBranch && leaves.map((l) => (
                  <line
                    key={`le-${l.idx}`}
                    x1={activeBranch.x} y1={activeBranch.y} x2={l.dotX} y2={l.dotY}
                    stroke={activeBranch.color}
                    strokeOpacity={0.55}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                ))}

                {/* Topic Bubbles with Reading Order Step Pill (1, 2, 3...) */}
                {branches.map((b, i) => {
                  const isOpen = expanded === i;
                  return (
                    <g
                      key={`b-${i}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(isOpen ? null : i);
                      }}
                      style={{ cursor: "pointer" }}
                      role="button"
                      tabIndex={0}
                    >
                      {/* Main Spherical Bubble */}
                      <circle
                        cx={b.x} cy={b.y} r={isOpen ? 70 : 62}
                        fill={`url(#branch-grad-${i % BRANCH_COLORS.length})`}
                        filter="url(#node-shadow)"
                        stroke="white"
                        strokeWidth={isOpen ? 3 : 1.5}
                        style={{ transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                      />
                      
                      {/* Numbered Step Pill Indicator */}
                      <circle
                        cx={b.x}
                        cy={b.y - (isOpen ? 70 : 62)}
                        r={14}
                        fill="white"
                        stroke={b.color}
                        strokeWidth={2.5}
                      />
                      <text
                        x={b.x}
                        y={b.y - (isOpen ? 70 : 62) + 4.5}
                        textAnchor="middle"
                        fill={NAVY}
                        fontSize={12.5}
                        fontWeight={800}
                        fontFamily={FONT_STACK}
                      >
                        {b.stepNumber}
                      </text>

                      {/* 104x104 Inscribed Box fits long titles cleanly */}
                      <foreignObject x={b.x - 52} y={b.y - 52} width={104} height={104}>
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            padding: "0 4px",
                            fontFamily: FONT_STACK,
                          }}
                        >
                          <span
                            style={{
                              color: "white",
                              fontSize: 13,
                              fontWeight: 700,
                              lineHeight: 1.25,
                              textShadow: "0 1px 3px rgba(0,0,0,0.3)",
                              display: "-webkit-box",
                              WebkitLineClamp: 4,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              wordBreak: "break-word",
                            }}
                          >
                            {topicLabel(b.title)}
                          </span>
                        </div>
                      </foreignObject>
                    </g>
                  );
                })}

                {/* Note Dots & Subtopic Badges (Rendered AFTER topic bubbles so #1 is NEVER hidden behind bubbles!) */}
                {activeBranch && leaves.map((l) => {
                  const isSel = selected?.section === expanded && selected?.note === l.idx;
                  return (
                    <g
                      key={`l-${l.idx}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected({ section: expanded as number, note: l.idx });
                      }}
                      style={{ cursor: "pointer" }}
                      role="button"
                      tabIndex={0}
                    >
                      {/* Note Leaf Anchor Dot */}
                      <circle
                        cx={l.dotX} cy={l.dotY} r={isSel ? 10 : 7}
                        fill={isSel ? activeBranch.color : "white"}
                        stroke={activeBranch.color} strokeWidth={2.5}
                        style={{ transition: "all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                      />

                      {/* 180x52 Card Box — Fits inside 1080px canvas without clipping left or right */}
                      <foreignObject x={l.boxX} y={l.boxY} width={180} height={52} overflow="visible">
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            fontFamily: FONT_STACK,
                            fontSize: 12.5,
                            lineHeight: 1.3,
                            textAlign: "left",
                            color: isSel ? NAVY : "#1e293b",
                            fontWeight: isSel ? 700 : 600,
                            background: isSel ? "#EEF3FB" : "rgba(255, 255, 255, 0.96)",
                            border: `1.5px solid ${isSel ? activeBranch.color : "#cbd5e1"}`,
                            borderLeft: `5px solid ${activeBranch.color}`,
                            padding: "6px 10px",
                            borderRadius: 12,
                            boxShadow: "0 4px 16px rgba(30, 39, 97, 0.1)",
                            display: "flex",
                            alignItems: "center",
                            wordBreak: "break-word",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            <span style={{ fontWeight: 800, color: activeBranch.color, marginRight: 6 }}>
                              #{l.noteNumber}
                            </span>
                            {extractSubtopic(l.note, l.idx)}
                          </div>
                        </div>
                      </foreignObject>
                    </g>
                  );
                })}

                {/* Center Node — Rich Navy Aura & Clear Lecture Title */}
                <circle cx={CENTER_X} cy={CENTER_Y} r={68} fill="url(#center-grad)" filter="url(#node-shadow)" stroke="white" strokeWidth={3} />
                <foreignObject x={CENTER_X - 54} y={CENTER_Y - 54} width={108} height={108}>
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      fontFamily: FONT_STACK,
                    }}
                  >
                    <span
                      style={{
                        color: "white",
                        fontSize: 14.5,
                        fontWeight: 800,
                        lineHeight: 1.25,
                        letterSpacing: "0.2px",
                        textShadow: "0 2px 5px rgba(0,0,0,0.35)",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        wordBreak: "break-word",
                      }}
                    >
                      {title || "Lecture"}
                    </span>
                  </div>
                </foreignObject>
              </g>
            </svg>
          </div>

          {/* Detail Bottom Drawer — Fixed in same frame; updates instantly on selection */}
          <div
            ref={detailRef}
            style={{
              background: selectedNoteText
                ? "linear-gradient(135deg, #EEF3FB 0%, #F6F4FF 100%)"
                : "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
              border: `1px solid ${selectedNoteText ? "#bfd5f5" : "#e2e8f0"}`,
              borderRadius: 16,
              padding: "16px 20px",
              minHeight: 80,
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
              boxShadow: selectedNoteText
                ? "0 4px 16px rgba(74, 144, 217, 0.1)"
                : "0 2px 8px rgba(0, 0, 0, 0.02)",
              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: selectedBranch ? selectedBranch.color : ACCENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: `0 3px 10px ${selectedBranch ? selectedBranch.color : ACCENT}44`,
              }}
            >
              {selectedNoteText ? (
                <CheckCircle2 style={{ width: 19, height: 19, color: "white" }} />
              ) : (
                <BookOpen style={{ width: 19, height: 19, color: "white" }} />
              )}
            </div>

            <div style={{ flex: 1 }}>
              {selectedNoteText ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                    <span
                      style={{
                        background: "white",
                        color: selectedBranch?.color,
                        fontSize: 11.5,
                        fontWeight: 800,
                        padding: "3px 9px",
                        borderRadius: 6,
                        border: `1px solid ${selectedBranch?.color}44`,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Step {selectedBranch?.stepNumber} — Note #{selected?.note !== undefined ? selected.note + 1 : ""}
                    </span>
                    <span style={{ color: NAVY, fontWeight: 700, fontSize: 14 }}>
                      {selectedBranch?.title}
                    </span>
                  </div>
                  <p style={{ color: NAVY, fontSize: 14.5, lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                    {selectedNoteText}
                  </p>
                </>
              ) : activeBranch ? (
                <>
                  <p style={{ color: NAVY, fontSize: 14.5, fontWeight: 700, margin: "0 0 3px" }}>
                    Step {activeBranch.stepNumber}: {activeBranch.title}
                  </p>
                  <p style={{ color: "#64748b", fontSize: 13.5, margin: 0 }}>
                    Tap subtopic badge <strong>#1</strong>, <strong>#2</strong>, or <strong>#3</strong> above to read the full explanation here instantly.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ color: NAVY, fontSize: 14.5, fontWeight: 700, margin: "0 0 3px" }}>
                    Interactive Lecture Mind Map
                  </p>
                  <p style={{ color: "#64748b", fontSize: 13.5, margin: 0 }}>
                    Tap any numbered topic bubble (<strong>1, 2, 3...</strong>) to explore this lecture's breakdown in clockwise order.
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        /* List Mode for users who explicitly switch to outline view */
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 6 }}>
          {branches.map((b, i) => {
            const isOpen = expanded === i;
            return (
              <div key={i} style={{ border: "1px solid #e2e8f4", borderRadius: 14, overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : i)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "12px 16px",
                    background: isOpen ? "#EEF3FB" : "#fafbfd",
                    borderBottom: isOpen ? `1.5px solid ${b.color}` : "none",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: b.color,
                      color: "white",
                      fontSize: 12,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {b.stepNumber}
                  </div>
                  <span style={{ flex: 1, color: NAVY, fontSize: 14.5, fontWeight: 700 }}>
                    {b.title}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>
                    {b.notes.length} notes
                  </span>
                  {isOpen ? (
                    <ChevronDown style={{ width: 18, height: 18, color: b.color }} />
                  ) : (
                    <ChevronRight style={{ width: 18, height: 18, color: "#94a3b8" }} />
                  )}
                </button>

                {isOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", background: "white" }}>
                    {b.notes.map((note, ni) => {
                      const isSel = selected?.section === i && selected?.note === ni;
                      return (
                        <div
                          key={ni}
                          onClick={() => setSelected(isSel ? null : { section: i, note: ni })}
                          style={{
                            cursor: "pointer",
                            background: isSel ? "#EEF3FB" : "#f8fafc",
                            border: `1px solid ${isSel ? b.color : "#e2e8f4"}`,
                            borderLeft: `4px solid ${b.color}`,
                            borderRadius: 10,
                            padding: "10px 14px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ color: b.color, fontWeight: 800, fontSize: 12 }}>#{ni + 1}</span>
                            <span style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>
                              {extractSubtopic(note, ni)}
                            </span>
                          </div>
                          <p style={{ margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.5 }}>
                            {note}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Kept as a default export too, in case anything else in the codebase
// imports this component the old way (`import MindMapView from ...`).
export default MindMapView;