import {
  BaseEdge,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';
import {
  DiagramEdgeData,
  buildRoundedPath,
  polylineMidpoint,
} from './layoutGraph';

/**
 * Renders an edge along the orthogonal route computed by ELK, with rounded
 * corners. Falls back to a smooth-step path when no route is available.
 */
export function ElkEdge({
  id,
  data,
  style,
  markerEnd,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<Edge<DiagramEdgeData>>) {
  const points = data?.points;
  let path: string;
  let labelX: number;
  let labelY: number;

  if (points && points.length >= 2) {
    path = buildRoundedPath(points, 10);
    const mid = polylineMidpoint(points);
    labelX = mid.x;
    labelY = mid.y;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 10,
    });
  }

  const isPort = data?.kind === 'port';

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={14} />
      {data?.showLabel && data.rawLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className={`nodrag nopan pointer-events-none absolute px-1.5 py-0.5 rounded-md text-xs leading-none bg-[var(--bg-panel)] border border-[var(--border-strong)] text-[var(--text-primary)] shadow-sm ${
              isPort ? 'font-mono' : ''
            }`}
          >
            {data.rawLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const diagramEdgeTypes = {
  elk: ElkEdge,
};
