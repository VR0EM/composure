import { DiagramNodeData, Finding } from '../core';
import { SEVERITY_DOT_COLORS } from './FindingsPanel';

interface NodeDetailsPanelProps {
  nodeData: DiagramNodeData | null;
  onJumpToLine: (line: number) => void;
}

export function NodeDetailsPanel({
  nodeData,
  onJumpToLine,
}: NodeDetailsPanelProps) {
  if (!nodeData) {
    return (
      <div className="p-8 text-center text-xs text-[var(--text-secondary)]">
        Click any service, port, network, or volume node in the diagram to
        inspect its configuration.
      </div>
    );
  }

  const isMonoTitle =
    nodeData.kind === 'hostPort' || nodeData.kind === 'bindMount';

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 text-xs">
      {/* Node Title & Line */}
      <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-[var(--border-subtle)]">
        <h2
          className={`text-sm font-semibold text-[var(--text-primary)] truncate ${
            isMonoTitle ? 'font-mono' : ''
          }`}
        >
          {nodeData.kind === 'service' && nodeData.service.name}
          {nodeData.kind === 'hostPort' && nodeData.exposureLabel}
          {nodeData.kind === 'network' && nodeData.network.name}
          {nodeData.kind === 'volume' && nodeData.volume.name}
          {nodeData.kind === 'bindMount' && nodeData.hostPath}
        </h2>
        {nodeData.kind === 'service' && (
          <button
            type="button"
            onClick={() => onJumpToLine(nodeData.service.line)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline shrink-0"
          >
            Line {nodeData.service.line}
          </button>
        )}
      </div>

      {nodeData.kind === 'service' && (
        <ServiceDetailsContent data={nodeData} onJumpToLine={onJumpToLine} />
      )}

      {nodeData.kind === 'hostPort' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">Source line</span>
            <button
              type="button"
              onClick={() => onJumpToLine(nodeData.port.line)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
            >
              Line {nodeData.port.line}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">Binding</span>
            <span className="font-mono text-[var(--text-primary)]">
              {nodeData.isPublicInternet
                ? 'All interfaces (0.0.0.0)'
                : 'Loopback only'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">Target</span>
            <span className="font-mono text-[var(--text-primary)]">
              {nodeData.serviceName}:{nodeData.port.target}/
              {nodeData.port.protocol}
            </span>
          </div>
        </div>
      )}

      {nodeData.kind === 'network' && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Type</span>
              <span className="text-[var(--text-primary)]">
                {nodeData.network.implicit
                  ? nodeData.network.name === 'default'
                    ? 'Implicit project network'
                    : 'Not declared (see Problems)'
                  : nodeData.network.external
                    ? 'External'
                    : nodeData.network.driver ?? 'bridge'}
              </span>
            </div>
            {nodeData.network.internal !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Internal</span>
                <span className="text-[var(--text-primary)]">
                  {String(nodeData.network.internal)}
                </span>
              </div>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Connected services ({nodeData.connectedServices.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {nodeData.connectedServices.map((svc) => (
                <span
                  key={svc}
                  className="text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded"
                >
                  {svc}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {nodeData.kind === 'volume' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">Driver</span>
            <span className="text-[var(--text-primary)]">
              {nodeData.volume.driver ?? 'local'}
            </span>
          </div>
          <div>
            <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Mounts ({nodeData.mounts.length})
            </h3>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {nodeData.mounts.map((m, idx) => (
                <li
                  key={`${m.service}-${idx}`}
                  className="py-1.5 flex items-center justify-between gap-2"
                >
                  <span className="text-[var(--text-primary)] truncate">
                    {m.service}{' '}
                    <span className="font-mono text-[var(--text-secondary)]">
                      {m.target}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] shrink-0">
                    {m.readOnly ? 'ro' : 'rw'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {nodeData.kind === 'bindMount' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Mounts ({nodeData.mounts.length})
            </h3>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {nodeData.mounts.map((m, idx) => (
                <li
                  key={`${m.service}-${idx}`}
                  className="py-1.5 flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={() => onJumpToLine(m.line)}
                    className="text-left text-[var(--text-primary)] hover:underline truncate"
                  >
                    <span>{m.service} </span>
                    <span className="font-mono text-[var(--text-secondary)]">
                      {m.target}
                    </span>
                  </button>
                  <span className="text-xs text-[var(--text-secondary)] shrink-0">
                    {m.readOnly ? 'ro' : 'rw'} L{m.line}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceDetailsContent({
  data,
  onJumpToLine,
}: {
  data: Extract<DiagramNodeData, { kind: 'service' }>;
  onJumpToLine: (line: number) => void;
}) {
  const { service, findings } = data;

  return (
    <div className="space-y-5">
      {/* Image & Runtime */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Image</span>
          <span
            className="font-mono text-[var(--text-primary)] truncate"
            title={service.image}
          >
            {service.image ?? 'build-only'}
          </span>
        </div>
        {service.build && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Build</span>
            <span className="font-mono text-[var(--text-primary)] truncate">
              {service.build.context ?? '.'}
            </span>
          </div>
        )}
        {service.networkMode && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Network mode</span>
            <span className="font-mono text-[var(--text-primary)]">
              {service.networkMode}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">User</span>
          <span className="font-mono text-[var(--text-primary)]">
            {service.user ?? 'image default'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Root filesystem</span>
          <span className="text-[var(--text-primary)]">
            {service.readOnly ? 'read-only' : 'writable'}
          </span>
        </div>
        {service.restart && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Restart</span>
            <span className="font-mono text-[var(--text-primary)]">{service.restart}</span>
          </div>
        )}
        {(service.secrets.length > 0 || service.configs.length > 0) && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Secrets / configs</span>
            <span className="font-mono text-[var(--text-primary)] text-right">
              {[...service.secrets.map((r) => r.source), ...service.configs.map((r) => r.source)].join(', ')}
            </span>
          </div>
        )}
        {service.profiles.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-secondary)]">Profiles</span>
            <span className="text-[var(--text-primary)]">
              {service.profiles.join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Ports */}
      {(service.ports.length > 0 || service.expose.length > 0) && (
        <div>
          <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            Ports
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)]/60">
            {service.ports.map((p, idx) => (
              <li
                key={idx}
                className="py-1 flex items-center justify-between gap-2"
              >
                <span className="font-mono text-[var(--text-primary)]">
                  {p.hostIp ? `${p.hostIp}:` : '0.0.0.0:'}
                  {p.published ?? '*'} → :{p.target}/{p.protocol}
                </span>
                <button
                  type="button"
                  onClick={() => onJumpToLine(p.line)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
                >
                  L{p.line}
                </button>
              </li>
            ))}
            {service.expose.map((e, idx) => (
              <li
                key={`exp-${idx}`}
                className="py-1 flex items-center justify-between gap-2 text-[var(--text-secondary)]"
              >
                <span>
                  expose{' '}
                  <span className="font-mono">
                    :{e.port}/{e.protocol}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onJumpToLine(e.line)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
                >
                  L{e.line}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mounts */}
      {service.volumes.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            Mounts
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)]/60">
            {service.volumes.map((v, idx) => (
              <li
                key={idx}
                className="py-1.5 flex items-center justify-between gap-2"
              >
                <span className="font-mono text-[var(--text-primary)] truncate">
                  {v.source ? `${v.source} → ` : ''}
                  {v.target}
                </span>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    {v.readOnly ? 'ro' : 'rw'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToLine(v.line)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
                  >
                    L{v.line}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Networks */}
      {service.networks.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            Networks
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {service.networks.map((n) => (
              <span
                key={n.name}
                className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              >
                {n.name}
                {n.implicit ? ' (default)' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Depends On */}
      {service.dependsOn.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            Depends on
          </h3>
          <ul className="divide-y divide-[var(--border-subtle)]/60">
            {service.dependsOn.map((d) => (
              <li
                key={d.target}
                className="py-1 flex items-center justify-between"
              >
                <span className="text-[var(--text-primary)]">{d.target}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {d.condition ?? 'service_started'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Compact List of Only This Service's Findings */}
      <div>
        <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-1">
          Findings ({findings.length})
        </h3>
        {findings.length === 0 ? (
          <p className="text-[var(--text-muted)]">
            No findings for this service.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]/60">
            {findings.map((f: Finding, idx: number) => (
              <li key={`${f.ruleId}-${idx}`}>
                <button
                  type="button"
                  onClick={() => onJumpToLine(f.line)}
                  className="w-full py-1.5 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)]/60 rounded px-1 -mx-1 transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      SEVERITY_DOT_COLORS[f.severity]
                    }`}
                  />
                  <span className="text-xs text-[var(--text-secondary)] shrink-0">
                    {f.ruleId}
                  </span>
                  <span className="text-xs text-[var(--text-primary)] truncate flex-1">
                    {f.title}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] shrink-0">
                    L{f.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
