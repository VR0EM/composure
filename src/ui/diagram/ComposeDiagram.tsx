import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Edge,
  Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ComposeGraph, DiagramNodeData } from '../../core';
import { diagramNodeTypes } from './CustomNodes';
import { diagramEdgeTypes } from './ElkEdge';
import {
  DiagramEdgeData,
  LayoutDirection,
  LayoutResult,
  fitZoomFor,
  layoutComposeGraphBoth,
} from './layoutGraph';

interface ComposeDiagramProps {
  graph: ComposeGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null, data: DiagramNodeData | null) => void;
  isStale: boolean;
  theme: 'dark' | 'light';
  layoutTrigger?: number;
  emptyContent?: ReactNode;
}

const FIT_PADDING = 0.05;
/** Never zoom in further than this on fit, so small stacks stay calm. */
const FIT_MAX_ZOOM = 1.15;
/**
 * Below this zoom node text is too small to read. The automatic fit stops
 * here and shows the start of the flow (pan for the rest); the Fit button
 * still shows everything.
 */
const MIN_READABLE_ZOOM = 0.6;

function DiagramCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
  isStale,
  layoutTrigger = 0,
  emptyContent,
}: ComposeDiagramProps) {
  const [layouts, setLayouts] = useState<Record<LayoutDirection, LayoutResult> | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [nodes, setNodes] = useState<Node<DiagramNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<DiagramEdgeData>[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const boundsRef = useRef<LayoutResult['bounds'] | null>(null);
  const { setViewport, zoomIn, zoomOut } = useReactFlow();

  // Pick the layout direction that gives the most readable zoom for this canvas.
  const direction: LayoutDirection = useMemo(() => {
    if (!layouts || containerSize.width === 0) return 'RIGHT';
    const zRight = fitZoomFor(layouts.RIGHT, containerSize, FIT_PADDING);
    const zDown = fitZoomFor(layouts.DOWN, containerSize, FIT_PADDING);
    return zDown > zRight * 1.1 ? 'DOWN' : 'RIGHT';
  }, [layouts, containerSize]);

  const fitDiagram = useCallback(
    (duration = 140, keepReadable = true) => {
      const bounds = boundsRef.current;
      const el = containerRef.current;
      if (!bounds || !el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw === 0 || ch === 0) return;
      const usableW = cw * (1 - FIT_PADDING * 2);
      const usableH = ch * (1 - FIT_PADDING * 2);
      const fit = Math.min(FIT_MAX_ZOOM, usableW / bounds.width, usableH / bounds.height);
      const zoom = keepReadable ? Math.max(fit, Math.min(MIN_READABLE_ZOOM, FIT_MAX_ZOOM)) : fit;
      const margin = Math.min(cw, ch) * FIT_PADDING;
      // Centre what fits; when the diagram is larger than the canvas, start at its top-left corner
      const x =
        bounds.width * zoom <= usableW ? (cw - bounds.width * zoom) / 2 - bounds.x * zoom : margin - bounds.x * zoom;
      const y =
        bounds.height * zoom <= usableH ? (ch - bounds.height * zoom) / 2 - bounds.y * zoom : margin - bounds.y * zoom;
      setViewport({ x, y, zoom }, { duration });
    },
    [setViewport],
  );

  // Run ELK (both directions) whenever the graph changes
  useEffect(() => {
    let cancelled = false;
    layoutComposeGraphBoth(graph).then((result) => {
      if (!cancelled) setLayouts(result);
    });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  // Apply the chosen layout and fit it
  useEffect(() => {
    if (!layouts) return;
    const layout = layouts[direction];
    boundsRef.current = layout.bounds;
    setNodes(layout.nodes);
    setEdges(layout.edges);
    const timer = window.setTimeout(() => fitDiagram(160), 30);
    return () => window.clearTimeout(timer);
  }, [layouts, direction, fitDiagram]);

  // Refit whenever a panel is collapsed or expanded
  useEffect(() => {
    const timer = window.setTimeout(() => fitDiagram(140), 50);
    return () => window.clearTimeout(timer);
  }, [layoutTrigger, fitDiagram]);

  // Track canvas size; refit on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setContainerSize({ width: el.clientWidth, height: el.clientHeight });
        fitDiagram(100);
      });
    });
    observer.observe(el);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [fitDiagram]);

  // Focus. A selected node keeps its neighbours bright and fades the rest; a
  // hovered node only highlights its own connections so nothing becomes hard to read.
  const focusId = selectedNodeId ?? hoveredNodeId;
  const neighbourSet = useMemo(() => {
    if (!selectedNodeId) return null;
    const set = new Set<string>([selectedNodeId]);
    for (const e of edges) {
      if (e.source === selectedNodeId) set.add(e.target);
      if (e.target === selectedNodeId) set.add(e.source);
    }
    return set;
  }, [selectedNodeId, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        className: neighbourSet && !neighbourSet.has(n.id) ? 'is-dimmed' : undefined,
      })),
    [nodes, selectedNodeId, neighbourSet],
  );

  const displayEdges = useMemo(() => {
    return edges.map((edge) => {
      const connected = focusId !== null && (edge.source === focusId || edge.target === focusId);
      const emphasized = edge.id === hoveredEdgeId || connected;
      let className: string | undefined;
      if (hoveredEdgeId && edge.id !== hoveredEdgeId && !connected) className = 'is-muted';
      else if (focusId && !connected) className = selectedNodeId ? 'is-dimmed' : 'is-muted';
      return {
        ...edge,
        className,
        zIndex: emphasized ? 1 : 0,
        data: { ...(edge.data as DiagramEdgeData), emphasized },
      };
    });
  }, [edges, hoveredEdgeId, selectedNodeId, focusId]);

  const hoveredDetail = hoveredEdgeId ? edges.find((e) => e.id === hoveredEdgeId)?.data?.detail : undefined;

  const trackPointer = (event: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  if (graph.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8 bg-[var(--bg-canvas)]">
        {emptyContent ?? (
          <p className="text-[13px] text-[var(--text-secondary)]">Paste or drop a docker-compose.yml file.</p>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[var(--bg-canvas)]">
      {isStale && (
        <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md bg-[var(--bg-panel)] border border-[var(--border-strong)] text-[var(--text-secondary)] text-xs shadow-[var(--node-shadow)] inline-flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--sev-medium-border)]" />
          The YAML has errors. Showing the last valid diagram.
        </div>
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeMouseEnter={(_event, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        onInit={() => {
          fitDiagram(0);
        }}
        onNodeClick={(_event, node) => {
          onSelectNode(node.id, node.data);
        }}
        onPaneClick={() => {
          onSelectNode(null, null);
        }}
        onEdgeMouseEnter={(event, edge) => {
          setHoveredEdgeId(edge.id);
          trackPointer(event);
        }}
        onEdgeMouseMove={(event) => trackPointer(event)}
        onEdgeMouseLeave={() => {
          setHoveredEdgeId(null);
          setTooltip(null);
        }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.25}
          color="var(--canvas-dot)"
        />
      </ReactFlow>

      {hoveredDetail && tooltip && (
        <EdgeTooltip
          detail={hoveredDetail}
          x={tooltip.x}
          y={tooltip.y}
          containerWidth={containerSize.width || containerRef.current?.clientWidth || 0}
        />
      )}

      {/* Toolbar and legend */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
        {showLegend && (
          <div className="w-60 p-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] text-xs text-[var(--text-secondary)] shadow-[0_8px_24px_rgb(0_0_0/0.14)] space-y-3">
            <div className="space-y-1.5">
              <LegendSwatch label="Service, border shows the worst finding" bg="var(--node-service-bg)" border="var(--sev-high-border)" />
              <LegendSwatch label="Published port" bg="var(--node-port-bg)" border="var(--node-port-border)" />
              <LegendSwatch label="Network" bg="var(--node-network-bg)" border="var(--node-network-border)" />
              <LegendSwatch label="Named volume" bg="var(--node-volume-bg)" border="var(--node-volume-border)" />
              <LegendSwatch label="Bind mount (host path)" bg="var(--node-bind-bg)" border="var(--node-bind-border)" />
            </div>
            <div className="space-y-1.5 pt-2.5 border-t border-[var(--border-subtle)]">
              <LegendLine label="Read-write mount" style={{ borderTopWidth: 2, borderColor: 'var(--node-volume-border)' }} />
              <LegendLine label="Read-only mount" style={{ borderTopWidth: 1, borderColor: 'var(--node-volume-border)' }} />
              <LegendLine label="depends_on" style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'var(--edge-depends)' }} />
              <LegendLine label="network_mode: service" style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'var(--node-network-border)' }} />
            </div>
            <p className="pt-2.5 border-t border-[var(--border-subtle)] text-[var(--text-muted)] leading-snug">
              Hover a line for details. Click a node to see its connections.
            </p>
          </div>
        )}

        <div className="inline-flex items-center rounded-lg overflow-hidden bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-[var(--node-shadow)] divide-x divide-[var(--border-subtle)] text-xs">
          <ToolbarButton label="Zoom out" onClick={() => zoomOut({ duration: 120 })}>
            −
          </ToolbarButton>
          <ToolbarButton label="Zoom in" onClick={() => zoomIn({ duration: 120 })}>
            +
          </ToolbarButton>
          <ToolbarButton label="Fit to view" onClick={() => fitDiagram(140, false)}>
            Fit
          </ToolbarButton>
          <ToolbarButton label="Legend" onClick={() => setShowLegend((v) => !v)} active={showLegend}>
            Legend
          </ToolbarButton>
        </div>
      </div>
    </div>
  );
}

function EdgeTooltip({
  detail,
  x,
  y,
  containerWidth,
}: {
  detail: DiagramEdgeData['detail'];
  x: number;
  y: number;
  containerWidth: number;
}) {
  const WIDTH = 280;
  const flip = x + 16 + WIDTH > containerWidth;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 max-w-[280px] px-2.5 py-2 rounded-md bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-[0_6px_20px_rgb(0_0_0/0.16)]"
      style={{
        left: flip ? undefined : x + 14,
        right: flip ? Math.max(8, containerWidth - x + 14) : undefined,
        top: y + 14,
      }}
    >
      <div className="text-xs font-medium text-[var(--text-primary)] font-mono break-all leading-snug">
        {detail.title}
      </div>
      <div className="mt-0.5 text-xs text-[var(--text-secondary)] leading-snug">{detail.text}</div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`h-8 min-w-8 px-2.5 transition-colors ${
        active
          ? 'bg-[var(--bg-subtle)] text-[var(--text-primary)] font-medium'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
      }`}
    >
      {children}
    </button>
  );
}

function LegendSwatch({ label, bg, border }: { label: string; bg: string; border: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-5 h-3 rounded-[3px] shrink-0 border" style={{ backgroundColor: bg, borderColor: border }} />
      <span>{label}</span>
    </div>
  );
}

function LegendLine({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-5 shrink-0 border-t" style={style} />
      <span>{label}</span>
    </div>
  );
}

export function ComposeDiagram(props: ComposeDiagramProps) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas {...props} />
    </ReactFlowProvider>
  );
}
