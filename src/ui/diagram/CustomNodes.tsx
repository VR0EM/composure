import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import {
  BindMountNodeData,
  HostPortNodeData,
  NetworkNodeData,
  ServiceNodeData,
  Severity,
  VolumeNodeData,
} from '../../core';

const HANDLE_CLASS =
  '!w-1 !h-1 !min-w-0 !min-h-0 !border-0 !bg-transparent !opacity-0';

const SELECTED_CLASS =
  'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-app)]';

const SEVERITY_BORDERS: Record<Severity | 'none', string> = {
  critical: 'border-[var(--sev-critical-border)]',
  high: 'border-[var(--sev-high-border)]',
  medium: 'border-[var(--sev-medium-border)]',
  low: 'border-[var(--sev-low-border)]',
  info: 'border-[var(--sev-info-border)]',
  none: 'border-[var(--node-service-border)]',
};

export function formatBindMountShortPath(hostPath: string): string {
  const trimmed = hostPath.trim();
  if (!trimmed) return hostPath;
  const segments = trimmed.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.length < 2) {
    return trimmed;
  }
  return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

export function ServiceNode({
  data,
  selected,
  width,
  height,
  sourcePosition,
  targetPosition,
}: NodeProps<Node<ServiceNodeData>>) {
  const borderClass = SEVERITY_BORDERS[data.worstSeverity];
  const { service } = data;
  const imageDisplay = `${data.imageName}:${data.imageTag}`;

  return (
    <div
      style={{
        width: width ?? 172,
        height: height ?? 54,
      }}
      className={`rounded-lg bg-[var(--node-service-bg)] border px-3 py-2 flex flex-col justify-center gap-0.5 shadow-[var(--node-shadow)] transition-[border-color,opacity] hover:border-[var(--border-hover)] ${borderClass} ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      <Handle
        type="target"
        position={targetPosition ?? Position.Left}
        className={HANDLE_CLASS}
      />

      <div className="text-[13px] leading-tight font-semibold text-[var(--text-primary)] truncate">
        {service.name}
      </div>

      <div
        className="text-xs leading-tight font-mono text-[var(--text-secondary)] truncate"
        title={imageDisplay}
      >
        {imageDisplay}
      </div>

      <Handle
        type="source"
        position={sourcePosition ?? Position.Right}
        className={HANDLE_CLASS}
      />
    </div>
  );
}

export function HostPortNode({
  data,
  selected,
  width,
  height,
  sourcePosition,
}: NodeProps<Node<HostPortNodeData>>) {
  return (
    <div
      style={{
        width: width ?? 164,
        height: height ?? 48,
      }}
      className={`rounded-lg bg-[var(--node-port-bg)] border border-[var(--node-port-border)] hover:border-[var(--border-hover)] px-3 py-1.5 flex flex-col justify-center gap-0.5 shadow-[var(--node-shadow)] transition-[border-color,opacity] ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      <div className="text-xs leading-tight text-[var(--node-port-fg)]">
        port
      </div>
      <div
        className="text-xs leading-tight font-mono text-[var(--text-primary)] whitespace-nowrap"
        title={data.exposureLabel}
      >
        {data.exposureLabel}
      </div>

      <Handle
        type="source"
        position={sourcePosition ?? Position.Right}
        className={HANDLE_CLASS}
      />
    </div>
  );
}

export function NetworkNode({
  data,
  selected,
  width,
  height,
  targetPosition,
}: NodeProps<Node<NetworkNodeData>>) {
  const { network } = data;
  return (
    <div
      style={{
        width: width ?? 136,
        height: height ?? 48,
      }}
      className={`rounded-lg bg-[var(--node-network-bg)] border border-[var(--node-network-border)] hover:border-[var(--border-hover)] px-3 py-1.5 flex flex-col justify-center gap-0.5 shadow-[var(--node-shadow)] transition-[border-color,opacity] ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      <Handle
        type="target"
        position={targetPosition ?? Position.Left}
        className={HANDLE_CLASS}
      />
      <div className="text-xs leading-tight text-[var(--node-network-fg)]">
        network
      </div>
      <div
        className="text-[13px] leading-tight font-medium text-[var(--text-primary)] truncate"
        title={network.name}
      >
        {network.name}
      </div>
    </div>
  );
}

export function VolumeNode({
  data,
  selected,
  width,
  height,
  targetPosition,
}: NodeProps<Node<VolumeNodeData>>) {
  const { volume } = data;
  const isAnon = volume.name.startsWith('anon:');
  const displayName = isAnon
    ? volume.name.split(':').slice(2).join(':')
    : volume.name;

  return (
    <div
      style={{
        width: width ?? 144,
        height: height ?? 48,
      }}
      className={`rounded-lg bg-[var(--node-volume-bg)] border border-[var(--node-volume-border)] hover:border-[var(--border-hover)] px-3 py-1.5 flex flex-col justify-center gap-0.5 shadow-[var(--node-shadow)] transition-[border-color,opacity] ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      <Handle
        type="target"
        position={targetPosition ?? Position.Left}
        className={HANDLE_CLASS}
      />
      <div className="text-xs leading-tight text-[var(--node-volume-fg)]">
        volume
      </div>
      <div
        className="text-[13px] leading-tight font-medium text-[var(--text-primary)] truncate"
        title={displayName}
      >
        {displayName}
      </div>
    </div>
  );
}

export function BindMountNode({
  data,
  selected,
  width,
  height,
  targetPosition,
}: NodeProps<Node<BindMountNodeData>>) {
  const shortPath = formatBindMountShortPath(data.hostPath);
  const allReadOnly =
    data.mounts.length > 0 && data.mounts.every((m) => m.readOnly);
  const allReadWrite =
    data.mounts.length > 0 && data.mounts.every((m) => !m.readOnly);
  const modeLabel = allReadOnly ? 'ro' : allReadWrite ? 'rw' : 'rw/ro';

  return (
    <div
      style={{
        width: width ?? 156,
        height: height ?? 48,
      }}
      title={data.hostPath}
      className={`rounded-lg bg-[var(--node-bind-bg)] border border-[var(--node-bind-border)] hover:border-[var(--border-hover)] px-3 py-1.5 flex flex-col justify-center gap-0.5 shadow-[var(--node-shadow)] transition-[border-color,opacity] ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      <Handle
        type="target"
        position={targetPosition ?? Position.Left}
        className={HANDLE_CLASS}
      />
      <div className="flex items-center justify-between gap-1.5 text-xs leading-tight">
        <span className="text-[var(--node-bind-fg)]">bind mount</span>
        <span className="font-mono text-[var(--text-secondary)]">
          {modeLabel}
        </span>
      </div>
      <div className="text-xs leading-tight font-mono text-[var(--text-primary)] whitespace-nowrap">
        {shortPath}
      </div>
    </div>
  );
}

export const diagramNodeTypes = {
  service: ServiceNode,
  hostPort: HostPortNode,
  network: NetworkNode,
  volume: VolumeNode,
  bindMount: BindMountNode,
};
