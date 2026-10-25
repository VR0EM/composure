import { BaseEdge, Edge, EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { DiagramEdgeData, buildRoundedPath } from './layoutGraph';

/**
 * Renders an edge along the orthogonal route computed by ELK, with rounded
 * corners. Falls back to a smooth-step path when no route is available.
 * Edges carry no inline labels: details appear in a tooltip on hover, so text
 * never ends up on top of nodes or other lines.
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
  const path =
    points && points.length >= 2
      ? buildRoundedPath(points, 10)
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          borderRadius: 10,
        })[0];

  const baseWidth = Number(style?.strokeWidth ?? 1.5);
  const edgeStyle = data?.emphasized ? { ...style, strokeWidth: baseWidth + 1 } : style;

  return <BaseEdge id={id} path={path} style={edgeStyle} markerEnd={markerEnd} interactionWidth={16} />;
}

export const diagramEdgeTypes = {
  elk: ElkEdge,
};
