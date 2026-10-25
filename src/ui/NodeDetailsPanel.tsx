import { ReactNode } from 'react';
import { DiagramNodeData, Finding } from '../core';
import { ArrowLeftIcon } from './Icons';
import { SeverityDot } from './primitives';

interface NodeDetailsPanelProps {
  nodeData: DiagramNodeData;
  onJumpToLine: (line: number) => void;
  onBack: () => void;
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-[var(--text-secondary)]">{label}</dt>
      <dd className={`text-[var(--text-primary)] min-w-0 break-words ${mono ? 'font-mono text-xs leading-5' : ''}`}>
        {children}
      </dd>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="px-4 py-3.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <h3 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">
        {title}
        {count !== undefined && <span className="ml-1.5 font-normal text-[var(--text-muted)] tabular">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function LineLink({ line, onJump }: { line: number; onJump: (line: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump(line)}
      className="shrink-0 text-xs tabular text-[var(--text-muted)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
    >
      L{line}
    </button>
  );
}

function ListRow({ children, line, onJump }: { children: ReactNode; line: number; onJump: (line: number) => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-[13px] border-b border-[var(--border-subtle)] last:border-b-0">
      <span className="min-w-0 truncate">{children}</span>
      <LineLink line={line} onJump={onJump} />
    </li>
  );
}

const KIND_LABELS: Record<DiagramNodeData['kind'], string> = {
  service: 'Service',
  hostPort: 'Published port',
  network: 'Network',
  volume: 'Named volume',
  bindMount: 'Bind mount',
};

export function NodeDetailsPanel({ nodeData, onJumpToLine, onBack }: NodeDetailsPanelProps) {
  const title =
    nodeData.kind === 'service'
      ? nodeData.service.name
      : nodeData.kind === 'hostPort'
        ? nodeData.exposureLabel
        : nodeData.kind === 'network'
          ? nodeData.network.name
          : nodeData.kind === 'volume'
            ? nodeData.volume.name.replace(/^anon:[^:]+:/, '')
            : nodeData.hostPath;
  const titleLine =
    nodeData.kind === 'service'
      ? nodeData.service.line
      : nodeData.kind === 'hostPort'
        ? nodeData.port.line
        : nodeData.kind === 'bindMount'
          ? nodeData.line
          : nodeData.kind === 'network'
            ? nodeData.network.line
            : nodeData.volume.line;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-3 pb-3.5 border-b border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Overview
        </button>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h2
            className={`text-[15px] font-semibold text-[var(--text-primary)] break-all ${
              nodeData.kind === 'hostPort' || nodeData.kind === 'bindMount' ? 'font-mono text-[13px]' : ''
            }`}
          >
            {title}
          </h2>
          <LineLink line={titleLine} onJump={onJumpToLine} />
        </div>
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{KIND_LABELS[nodeData.kind]}</div>
      </div>

      {nodeData.kind === 'service' && <ServiceDetails data={nodeData} onJumpToLine={onJumpToLine} />}

      {nodeData.kind === 'hostPort' && (
        <Section title="Binding">
          <dl>
            <Row label="Reachable from">
              {nodeData.isPublicInternet ? (
                <span style={{ color: 'var(--sev-high-fg)' }}>Every network interface</span>
              ) : (
                'This host only (loopback)'
              )}
            </Row>
            <Row label="Target" mono>
              {nodeData.serviceName}:{nodeData.port.target}/{nodeData.port.protocol}
            </Row>
            {nodeData.port.mode && <Row label="Mode">{nodeData.port.mode}</Row>}
          </dl>
        </Section>
      )}

      {nodeData.kind === 'network' && (
        <>
          <Section title="Configuration">
            <dl>
              <Row label="Type">
                {nodeData.network.implicit
                  ? nodeData.network.name === 'default'
                    ? 'Implicit project network'
                    : 'Not declared (see Problems)'
                  : nodeData.network.external
                    ? 'External'
                    : nodeData.network.driver ?? 'bridge'}
              </Row>
              <Row label="Internal only">{nodeData.network.internal ? 'Yes, no outside access' : 'No'}</Row>
            </dl>
          </Section>
          <Section title="Connected services" count={nodeData.connectedServices.length}>
            <div className="flex flex-wrap gap-1.5">
              {nodeData.connectedServices.map((svc) => (
                <span
                  key={svc}
                  className="text-xs text-[var(--text-primary)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded-md"
                >
                  {svc}
                </span>
              ))}
            </div>
          </Section>
        </>
      )}

      {(nodeData.kind === 'volume' || nodeData.kind === 'bindMount') && (
        <>
          {nodeData.kind === 'volume' && (
            <Section title="Configuration">
              <dl>
                <Row label="Driver">{nodeData.volume.driver ?? 'local'}</Row>
                {nodeData.volume.external && <Row label="External">Yes</Row>}
              </dl>
            </Section>
          )}
          <Section title="Mounted by" count={nodeData.mounts.length}>
            <ul>
              {nodeData.mounts.map((m, idx) => (
                <ListRow key={`${m.service}-${idx}`} line={m.line} onJump={onJumpToLine}>
                  <span className="text-[var(--text-primary)]">{m.service}</span>{' '}
                  <span className="font-mono text-xs text-[var(--text-secondary)]">{m.target}</span>{' '}
                  <span className="text-xs text-[var(--text-muted)]">{m.readOnly ? 'read-only' : 'read-write'}</span>
                </ListRow>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

function ServiceDetails({
  data,
  onJumpToLine,
}: {
  data: Extract<DiagramNodeData, { kind: 'service' }>;
  onJumpToLine: (line: number) => void;
}) {
  const { service, findings } = data;

  return (
    <>
      <Section title="Runtime">
        <dl>
          <Row label="Image" mono>
            {service.image ?? `build: ${service.build?.context ?? '.'}`}
          </Row>
          <Row label="User" mono>
            {service.user ?? <span className="font-sans text-[var(--text-muted)]">image default</span>}
          </Row>
          <Row label="Root filesystem">{service.readOnly ? 'Read-only' : 'Writable'}</Row>
          {service.networkMode && (
            <Row label="Network mode" mono>
              {service.networkMode}
            </Row>
          )}
          {service.restart && (
            <Row label="Restart" mono>
              {service.restart}
            </Row>
          )}
          {service.profiles.length > 0 && <Row label="Profiles">{service.profiles.join(', ')}</Row>}
          {(service.secrets.length > 0 || service.configs.length > 0) && (
            <Row label="Secrets, configs" mono>
              {[...service.secrets, ...service.configs].map((r) => r.source).join(', ')}
            </Row>
          )}
        </dl>
      </Section>

      <Section title="Findings" count={findings.length}>
        {findings.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">No findings for this service.</p>
        ) : (
          <ul>
            {findings.map((f: Finding, idx: number) => (
              <li key={`${f.ruleId}-${idx}`} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => onJumpToLine(f.line)}
                  className="w-full py-1.5 text-left flex items-center gap-2.5 text-[13px] hover:text-[var(--text-primary)]"
                >
                  <SeverityDot severity={f.severity} />
                  <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">{f.title}</span>
                  <span className="shrink-0 text-xs tabular text-[var(--text-muted)]">L{f.line}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(service.ports.length > 0 || service.expose.length > 0) && (
        <Section title="Ports" count={service.ports.length + service.expose.length}>
          <ul>
            {service.ports.map((p, idx) => (
              <ListRow key={idx} line={p.line} onJump={onJumpToLine}>
                <span className="font-mono text-xs text-[var(--text-primary)]">
                  {p.hostIp ? `${p.hostIp}:` : '0.0.0.0:'}
                  {p.published ?? '*'} → {p.target}/{p.protocol}
                </span>
              </ListRow>
            ))}
            {service.expose.map((e, idx) => (
              <ListRow key={`exp-${idx}`} line={e.line} onJump={onJumpToLine}>
                <span className="text-xs text-[var(--text-secondary)]">internal</span>{' '}
                <span className="font-mono text-xs text-[var(--text-primary)]">
                  {e.port}/{e.protocol}
                </span>
              </ListRow>
            ))}
          </ul>
        </Section>
      )}

      {service.volumes.length > 0 && (
        <Section title="Mounts" count={service.volumes.length}>
          <ul>
            {service.volumes.map((v, idx) => (
              <ListRow key={idx} line={v.line} onJump={onJumpToLine}>
                <span className="font-mono text-xs text-[var(--text-primary)]">
                  {v.source ? `${v.source} → ` : v.type === 'tmpfs' ? 'tmpfs → ' : ''}
                  {v.target}
                </span>{' '}
                <span className="text-xs text-[var(--text-muted)]">{v.readOnly ? 'ro' : 'rw'}</span>
              </ListRow>
            ))}
          </ul>
        </Section>
      )}

      {(service.networks.length > 0 || service.dependsOn.length > 0) && (
        <Section title="Connections">
          <dl>
            {service.networks.length > 0 && (
              <Row label="Networks">
                {service.networks.map((n) => `${n.name}${n.implicit ? ' (implicit)' : ''}`).join(', ')}
              </Row>
            )}
            {service.dependsOn.length > 0 && (
              <Row label="Depends on">
                {service.dependsOn.map((d) => (
                  <span key={d.target} className="block">
                    {d.target}{' '}
                    {d.condition && d.condition !== 'service_started' && (
                      <span className="text-xs text-[var(--text-muted)]">{d.condition.replace('service_', '')}</span>
                    )}
                  </span>
                ))}
              </Row>
            )}
          </dl>
        </Section>
      )}
    </>
  );
}
