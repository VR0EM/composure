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

const FIT_PADDING = 0.08;
/** Never zoom in further than this on fit, so small stacks stay calm. */
const FIT_MAX_ZOOM = 1.15;

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
    (duration = 140) => {
      const bounds = boundsRef.current;
      const el = containerRef.current;
      if (!bounds || !el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw === 0 || ch === 0) return;
      const usableW = cw * (1 - FIT_PADDING * 2);
      const usableH = ch * (1 - FIT_PADDING * 2);
      const zoom = Math.min(FIT_MAX_ZOOM, usableW / bounds.width, usableH / bounds.height);
      const x = (cw - bounds.width * zoom) / 2 - bounds.x * zoom;
      const y = (ch - bounds.height * zoom) / 2 - bounds.y * zoom;
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

  // Focus: the selected (or hovered) node and its direct neighbours stay bright
  const focusId = selectedNodeId ?? hoveredNodeId;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const e of edges) {
      if (e.source === focusId) set.add(e.target);
      if (e.target === focusId) set.add(e.source);
    }
    return set;
  }, [focusId, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        className: focusSet && !focusSet.has(n.id) ? 'is-dimmed' : undefined,
      })),
    [nodes, selectedNodeId, focusSet],
  );

  // Edge labels only on hover or when a connected node is selected
  const displayEdges = useMemo(() => {
    return edges.map((edge) => {
      const connected =
        focusId !== null && (edge.source === focusId || edge.target === focusId);
      const showLabel =
        edge.id === hoveredEdgeId ||
        (selectedNodeId !== null &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId));
      return {
        ...edge,
        className: focusId && !connected ? 'is-dimmed' : undefined,
        data: { ...(edge.data as DiagramEdgeData), showLabel },
      };
    });
  }, [edges, hoveredEdgeId, selectedNodeId, focusId]);

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
        onEdgeMouseEnter={(_event, edge) => {
          setHoveredEdgeId(edge.id);
        }}
        onEdgeMouseLeave={() => {
          setHoveredEdgeId(null);
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
          </div>
        )}

        <div className="inline-flex items-center rounded-lg overflow-hidden bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-[var(--node-shadow)] divide-x divide-[var(--border-subtle)] text-xs">
          <ToolbarButton label="Zoom out" onClick={() => zoomOut({ duration: 120 })}>
            −
          </ToolbarButton>
          <ToolbarButton label="Zoom in" onClick={() => zoomIn({ duration: 120 })}>
            +
          </ToolbarButton>
          <ToolbarButton label="Fit to view" onClick={() => fitDiagram(140)}>
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
