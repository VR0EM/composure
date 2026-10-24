import ELK from 'elkjs/lib/elk.bundled.js';
import { Edge, MarkerType, Node, Position } from '@xyflow/react';
import { ComposeGraph, DiagramEdge, DiagramNode, DiagramNodeData } from '../../core';

const elk = new ELK();

export type LayoutDirection = 'RIGHT' | 'DOWN';

export interface XYPoint {
  x: number;
  y: number;
}

export interface DiagramEdgeData extends Record<string, unknown> {
  rawLabel?: string;
  kind: DiagramEdge['kind'];
  readOnly?: boolean;
  /** Orthogonal route computed by ELK (start, bends, end) in flow coordinates. */
  points?: XYPoint[];
  showLabel?: boolean;
}

export interface LayoutResult {
  direction: LayoutDirection;
  nodes: Node<DiagramNodeData>[];
  edges: Edge<DiagramEdgeData>[];
  bounds: { x: number; y: number; width: number; height: number };
}

function getEdgeStyle(edge: DiagramEdge): {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
} {
  switch (edge.kind) {
    case 'dependsOn':
      return {
        stroke: 'var(--edge-depends)',
        strokeWidth: 1.25,
        strokeDasharray: '4 4',
      };
    case 'port':
      return { stroke: 'var(--node-port-border)', strokeWidth: 1.5 };
    case 'network':
      return { stroke: 'var(--node-network-border)', strokeWidth: 1.5 };
    case 'volume': {
      const isBind = edge.target.startsWith('bind:');
      return {
        stroke: isBind ? 'var(--node-bind-border)' : 'var(--node-volume-border)',
        strokeWidth: edge.readOnly ? 1 : 1.75,
      };
    }
  }
}

export async function layoutComposeGraph(
  graph: ComposeGraph,
  direction: LayoutDirection = 'RIGHT',
): Promise<LayoutResult> {
  if (graph.nodes.length === 0) {
    return {
      direction,
      nodes: [],
      edges: [],
      bounds: { x: 0, y: 0, width: 400, height: 300 },
    };
  }

  const nodeIdSet = new Set(graph.nodes.map((n) => n.id));
  const validEdges = graph.edges.filter(
    (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target),
  );

  const horizontal = direction === 'RIGHT';

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.mergeEdges': 'false',
      'elk.spacing.nodeNode': horizontal ? '24' : '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': horizontal ? '48' : '44',
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '10',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
    },
    children: graph.nodes.map((node: DiagramNode) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: validEdges.map((edge: DiagramEdge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const laidOut = await elk.layout(elkGraph);
  const positions = new Map<string, XYPoint>();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of laidOut.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    const w = child.width ?? 172;
    const h = child.height ?? 54;
    positions.set(child.id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const routes = new Map<string, XYPoint[]>();
  for (const e of (laidOut.edges ?? []) as Array<{
    id: string;
    sections?: Array<{
      startPoint: XYPoint;
      endPoint: XYPoint;
      bendPoints?: XYPoint[];
    }>;
  }>) {
    const section = e.sections?.[0];
    if (!section) continue;
    const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    routes.set(e.id, pts);
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  const flowNodes: Node<DiagramNodeData>[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    width: node.width,
    height: node.height,
    sourcePosition: horizontal ? Position.Right : Position.Bottom,
    targetPosition: horizontal ? Position.Left : Position.Top,
    data: node.data,
  }));

  const flowEdges: Edge<DiagramEdgeData>[] = validEdges.map((edge) => {
    const edgeStyle = getEdgeStyle(edge);
    return {
      id: edge.id,
      type: 'elk',
      source: edge.source,
      target: edge.target,
      data: {
        rawLabel: edge.label,
        kind: edge.kind,
        readOnly: edge.readOnly,
        points: routes.get(edge.id),
      },
      style: edgeStyle,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeStyle.stroke,
        width: 12,
        height: 12,
      },
    };
  });

  const bounds = {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Number.isFinite(maxX - minX) && maxX > minX ? maxX - minX : 400,
    height: Number.isFinite(maxY - minY) && maxY > minY ? maxY - minY : 300,
  };

  return { direction, nodes: flowNodes, edges: flowEdges, bounds };
}

/** Build an SVG path through orthogonal points with rounded corners. */
export function buildRoundedPath(points: XYPoint[], radius = 8): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    if (r <= 0.5) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }
    const inX = curr.x - ((curr.x - prev.x) / lenIn) * r;
    const inY = curr.y - ((curr.y - prev.y) / lenIn) * r;
    const outX = curr.x + ((next.x - curr.x) / lenOut) * r;
    const outY = curr.y + ((next.y - curr.y) / lenOut) * r;
    d += ` L ${inX} ${inY} Q ${curr.x} ${curr.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Midpoint along an orthogonal polyline (by length), used for edge labels. */
export function polylineMidpoint(points: XYPoint[]): XYPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= remaining && seg > 0) {
      const t = remaining / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg;
  }
  return points[points.length - 1]!;
}

/** Lay out in both directions so the canvas can pick the one that reads best. */
export async function layoutComposeGraphBoth(
  graph: ComposeGraph,
): Promise<Record<LayoutDirection, LayoutResult>> {
  const [right, down] = await Promise.all([
    layoutComposeGraph(graph, 'RIGHT'),
    layoutComposeGraph(graph, 'DOWN'),
  ]);
  return { RIGHT: right, DOWN: down };
}

/** Zoom level at which the layout would fit inside the given viewport. */
export function fitZoomFor(
  layout: LayoutResult,
  viewport: { width: number; height: number },
  padding = 0.12,
): number {
  const usableW = viewport.width * (1 - padding * 2);
  const usableH = viewport.height * (1 - padding * 2);
  if (usableW <= 0 || usableH <= 0) return 0;
  return Math.min(usableW / layout.bounds.width, usableH / layout.bounds.height);
}
