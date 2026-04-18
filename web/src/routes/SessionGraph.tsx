import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { agentColor, formatUSD } from "../lib/format";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { useMemo } from "react";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";

interface Node {
  kind: "session" | "call";
  agent?: string;
  callee?: string;
  sessionId?: string;
  prompt?: string;
  eventId: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  events: number;
  children: Node[];
}

export function SessionGraphPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["session-graph", id],
    queryFn: () => api.sessionGraph(id),
    refetchInterval: 5_000,
  });

  const root = q.data?.graph as Node | null | undefined;

  const layout = useMemo(() => {
    if (!root) return null;
    const h = hierarchy<Node>(root, (n) => n.children);
    const nodeCount = h.descendants().length;
    const width = Math.max(900, nodeCount * 30);
    const height = Math.max(400, h.height * 120 + 120);
    const layouter = tree<Node>().size([width, height - 80]);
    const positioned = layouter(h);
    return { positioned, width, height };
  }, [root]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">call graph</h1>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {q.isLoading && <div className="text-fg-dim">loading…</div>}
        {!q.isLoading && !root && (
          <div className="text-fg-dim">
            No call graph — this session didn't spawn any sub-agents or shell-out to other CLIs.
          </div>
        )}
        {root && layout && (
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4 overflow-auto">
            <svg width={layout.width} height={layout.height} className="mono">
              {/* Edges */}
              {layout.positioned.links().map((link, i) => (
                <path
                  key={i}
                  d={linkPath(link.source, link.target)}
                  fill="none"
                  stroke="#2b3139"
                  strokeWidth={1.5}
                />
              ))}
              {/* Nodes */}
              {layout.positioned.descendants().map((n) => (
                <GraphNode key={n.data.eventId} node={n} />
              ))}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function linkPath(s: HierarchyPointNode<Node>, t: HierarchyPointNode<Node>): string {
  // Smooth S-curve from source to target.
  const midY = (s.y + t.y) / 2;
  return `M${s.x},${s.y} C${s.x},${midY} ${t.x},${midY} ${t.x},${t.y}`;
}

function GraphNode({ node }: { node: HierarchyPointNode<Node> }) {
  const d = node.data;
  const label = d.kind === "session"
    ? d.agent ?? "session"
    : `→ ${d.callee ?? "call"}`;
  const linkTo = d.sessionId ? `/sessions/${encodeURIComponent(d.sessionId)}` : null;
  return (
    <g transform={`translate(${node.x},${node.y})`}>
      <rect
        x={-80}
        y={-22}
        width={160}
        height={44}
        rx={6}
        fill="#12151a"
        stroke={d.kind === "call" ? "#d29922" : "#2b3139"}
        strokeWidth={1}
      />
      <text textAnchor="middle" y={-5} fontSize="11" className={clsx(agentColor(d.agent ?? d.callee ?? "unknown" as any))}>
        {label}
      </text>
      <text textAnchor="middle" y={10} fontSize="9" fill="#7d8590">
        {d.events} ev · {formatUSD(d.cost)}
      </text>
      {linkTo && (
        <a href={linkTo}>
          <rect x={-80} y={-22} width={160} height={44} fill="transparent" />
        </a>
      )}
    </g>
  );
}
