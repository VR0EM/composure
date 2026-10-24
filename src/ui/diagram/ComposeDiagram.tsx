import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
      <div className="w-full h-full flex items-center justify-center p-8 bg-[var(--bg-app)]">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Paste or drop a docker-compose.yml file
          </h2>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Composure is 100% client-side. There is no backend, no external API
            calls, no analytics, and no telemetry. Your Compose file never
            leaves your browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[var(--bg-app)]">
      {isStale && (
        <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md bg-[var(--sev-medium-group-bg)] border border-[var(--sev-medium-border)] text-[var(--sev-medium-fg)] text-xs">
          YAML has errors: showing last valid diagram
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

      {/* Flat Canvas Toolbar & Legend Popover */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
        {showLegend && (
          <div className="p-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-strong)] text-xs text-[var(--text-secondary)] shadow-md space-y-2 min-w-[215px]">
            <div className="font-medium text-[var(--text-primary)] pb-1 border-b border-[var(--border-subtle)]">
              Legend
            </div>
            <div className="space-y-1">
              <div className="text-[var(--text-muted)]">Node types</div>
              <div className="flex items-center justify-between gap-3">
                <span>Published port (public / loopback)</span>
                <span className="w-5 h-2.5 rounded-sm bg-[var(--node-port-bg)] border border-[var(--node-port-border)] inline-block" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Network</span>
                <span className="w-5 h-2.5 rounded-sm bg-[var(--node-network-bg)] border border-[var(--node-network-border)] inline-block" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Named volume</span>
                <span className="w-5 h-2.5 rounded-sm bg-[var(--node-volume-bg)] border border-[var(--node-volume-border)] inline-block" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Bind mount</span>
                <span className="w-5 h-2.5 rounded-sm bg-[var(--node-bind-bg)] border border-[var(--node-bind-border)] inline-block" />
              </div>
            </div>
            <div className="space-y-1 pt-1 border-t border-[var(--border-subtle)]">
              <div className="text-[var(--text-muted)]">Mounts &amp; links</div>
              <div className="flex items-center justify-between gap-3">
                <span>Read-write (rw)</span>
                <span className="w-6 border-t-2 border-[var(--node-volume-border)] inline-block" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Read-only (ro)</span>
                <span className="w-6 border-t border-[var(--node-bind-border)] inline-block" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>depends_on</span>
                <span className="w-6 border-t border-dashed border-[var(--edge-depends)] inline-block" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>network_mode: service</span>
                <span className="w-6 border-t border-dashed border-[var(--node-network-border)] inline-block" />
              </div>
            </div>
          </div>
        )}

        <div className="inline-flex items-center rounded-lg overflow-hidden bg-[var(--bg-panel)] border border-[var(--border-strong)] shadow-sm divide-x divide-[var(--border-subtle)] text-xs">
          <button
            type="button"
            onClick={() => zoomOut({ duration: 120 })}
            title="Zoom out"
            aria-label="Zoom out"
            className="h-7 px-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => zoomIn({ duration: 120 })}
            title="Zoom in"
            aria-label="Zoom in"
            className="h-7 px-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => fitDiagram(140)}
            title="Fit diagram to viewport"
            className="h-7 px-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => setShowLegend((v) => !v)}
            title="Toggle legend"
            className={`h-7 px-2.5 transition-colors ${
              showLegend
                ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
            }`}
          >
            Legend
          </button>
        </div>
      </div>
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
