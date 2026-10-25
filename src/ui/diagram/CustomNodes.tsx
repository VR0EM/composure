import { ReactNode } from 'react';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import {
  BindMountNodeData,
  HostPortNodeData,
  NetworkNodeData,
  ServiceNodeData,
  Severity,
  VolumeNodeData,
} from '../../core';
import { DatabaseVolumeIcon, FolderMountIcon, GlobePortIcon, NetworkSwitchIcon } from '../Icons';

const HANDLE_CLASS = '!w-1 !h-1 !min-w-0 !min-h-0 !border-0 !bg-transparent !opacity-0';

const SELECTED_CLASS = 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-canvas)]';

const SEVERITY_BORDER: Record<Severity | 'none', string> = {
  critical: 'var(--sev-critical-border)',
  high: 'var(--sev-high-border)',
  medium: 'var(--sev-medium-border)',
  low: 'var(--node-service-border)',
  info: 'var(--node-service-border)',
  none: 'var(--node-service-border)',
};

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'var(--sev-critical-fg)',
  high: 'var(--sev-high-fg)',
  medium: 'var(--sev-medium-fg)',
  low: 'var(--sev-low-fg)',
  info: 'var(--sev-info-fg)',
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

/** Shared frame for the smaller typed nodes (port, network, volume, bind mount). */
function TypedNode({
  width,
  height,
  selected,
  bg,
  border,
  fg,
  icon,
  label,
  tag,
  tagColor,
  title,
  mono = false,
  hoverTitle,
  children,
}: {
  width: number;
  height: number;
  selected: boolean;
  bg: string;
  border: string;
  fg: string;
  icon: ReactNode;
  label: string;
  tag?: string;
  tagColor?: string;
  title: string;
  mono?: boolean;
  hoverTitle?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{ width, height, backgroundColor: bg, borderColor: border }}
      title={hoverTitle ?? title}
      className={`rounded-lg border px-3 py-1.5 flex flex-col justify-center gap-0.5 shadow-[var(--node-shadow)] transition-[opacity,box-shadow] ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      {children}
      <div className="flex items-center justify-between gap-2 text-[11px] leading-tight font-medium">
        <span className="inline-flex items-center gap-1.5 min-w-0" style={{ color: fg }}>
          <span className="w-3 h-3 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        {tag && (
          <span className="shrink-0" style={{ color: tagColor ?? 'var(--text-secondary)' }}>
            {tag}
          </span>
        )}
      </div>
      <div
        className={`leading-tight text-[var(--text-primary)] truncate ${
          mono ? 'font-mono text-xs' : 'text-[13px] font-medium'
        }`}
      >
        {title}
      </div>
    </div>
  );
}

export function ServiceNode({
  data,
  selected,
  width,
  height,
  sourcePosition,
  targetPosition,
}: NodeProps<Node<ServiceNodeData>>) {
  const { service } = data;
  const imageDisplay = `${data.imageName}:${data.imageTag}`;
  const visibleFindings = data.findings.filter((f) => f.severity !== 'info').length;
  const showCount = data.worstSeverity !== 'none' && data.worstSeverity !== 'info' && visibleFindings > 0;
  const strongBorder = data.worstSeverity === 'critical' || data.worstSeverity === 'high' || data.worstSeverity === 'medium';

  return (
    <div
      style={{
        width: width ?? 172,
        height: height ?? 54,
        borderColor: SEVERITY_BORDER[data.worstSeverity],
        borderWidth: strongBorder ? 1.5 : 1,
      }}
      className={`rounded-lg bg-[var(--node-service-bg)] border px-3 py-2 flex flex-col justify-center gap-1 shadow-[var(--node-shadow)] transition-[opacity,box-shadow] ${
        selected ? SELECTED_CLASS : ''
      }`}
    >
      <Handle type="target" position={targetPosition ?? Position.Left} className={HANDLE_CLASS} />

      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] leading-tight font-semibold text-[var(--text-primary)] truncate">{service.name}</div>
        {showCount && (
          <span
            className="shrink-0 inline-flex items-center gap-1 text-[11px] leading-none font-medium tabular"
            style={{ color: SEVERITY_TEXT[data.worstSeverity as Severity] }}
            title={`${visibleFindings} finding(s), worst: ${data.worstSeverity}`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SEVERITY_BORDER[data.worstSeverity] }} />
            {visibleFindings}
          </span>
        )}
      </div>

      <div className="text-xs leading-tight font-mono text-[var(--text-secondary)] truncate" title={imageDisplay}>
        {imageDisplay}
      </div>

      <Handle type="source" position={sourcePosition ?? Position.Right} className={HANDLE_CLASS} />
    </div>
  );
}

export function HostPortNode({ data, selected, width, height, sourcePosition }: NodeProps<Node<HostPortNodeData>>) {
  return (
    <TypedNode
      width={width ?? 164}
      height={height ?? 48}
      selected={!!selected}
      bg="var(--node-port-bg)"
      border="var(--node-port-border)"
      fg="var(--node-port-fg)"
      icon={<GlobePortIcon className="w-3 h-3" />}
      label="Port"
      tag={data.isPublicInternet ? 'public' : 'loopback'}
      tagColor={data.isPublicInternet ? 'var(--sev-high-fg)' : 'var(--text-secondary)'}
      title={data.exposureLabel}
      hoverTitle={data.isPublicInternet ? `${data.exposureLabel}: reachable on every interface` : `${data.exposureLabel}: this host only`}
      mono
    >
      <Handle type="source" position={sourcePosition ?? Position.Right} className={HANDLE_CLASS} />
    </TypedNode>
  );
}

export function NetworkNode({ data, selected, width, height, targetPosition }: NodeProps<Node<NetworkNodeData>>) {
  const { network } = data;
  return (
    <TypedNode
      width={width ?? 136}
      height={height ?? 48}
      selected={!!selected}
      bg="var(--node-network-bg)"
      border="var(--node-network-border)"
      fg="var(--node-network-fg)"
      icon={<NetworkSwitchIcon className="w-3 h-3" />}
      label="Network"
      {...(network.internal ? { tag: 'internal' } : network.external ? { tag: 'external' } : {})}
      title={network.name}
    >
      <Handle type="target" position={targetPosition ?? Position.Left} className={HANDLE_CLASS} />
    </TypedNode>
  );
}

export function VolumeNode({ data, selected, width, height, targetPosition }: NodeProps<Node<VolumeNodeData>>) {
  const { volume } = data;
  const isAnon = volume.name.startsWith('anon:');
  const displayName = isAnon ? volume.name.split(':').slice(2).join(':') : volume.name;
  return (
    <TypedNode
      width={width ?? 144}
      height={height ?? 48}
      selected={!!selected}
      bg="var(--node-volume-bg)"
      border="var(--node-volume-border)"
      fg="var(--node-volume-fg)"
      icon={<DatabaseVolumeIcon className="w-3 h-3" />}
      label={isAnon ? 'Anonymous volume' : 'Volume'}
      title={displayName}
      mono={isAnon}
    >
      <Handle type="target" position={targetPosition ?? Position.Left} className={HANDLE_CLASS} />
    </TypedNode>
  );
}

export function BindMountNode({ data, selected, width, height, targetPosition }: NodeProps<Node<BindMountNodeData>>) {
  const shortPath = formatBindMountShortPath(data.hostPath);
  const allReadOnly = data.mounts.length > 0 && data.mounts.every((m) => m.readOnly);
  const allReadWrite = data.mounts.length > 0 && data.mounts.every((m) => !m.readOnly);
  const modeLabel = allReadOnly ? 'ro' : allReadWrite ? 'rw' : 'rw/ro';

  return (
    <TypedNode
      width={width ?? 156}
      height={height ?? 48}
      selected={!!selected}
      bg="var(--node-bind-bg)"
      border="var(--node-bind-border)"
      fg="var(--node-bind-fg)"
      icon={<FolderMountIcon className="w-3 h-3" />}
      label="Bind mount"
      tag={modeLabel}
      title={shortPath}
      hoverTitle={data.hostPath}
      mono
    >
      <Handle type="target" position={targetPosition ?? Position.Left} className={HANDLE_CLASS} />
    </TypedNode>
  );
}

export const diagramNodeTypes = {
  service: ServiceNode,
  hostPort: HostPortNode,
  network: NetworkNode,
  volume: VolumeNode,
  bindMount: BindMountNode,
};
