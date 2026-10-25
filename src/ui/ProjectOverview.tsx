import { useMemo } from 'react';
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ComposeModel,
  Finding,
  SecurityScoreSummary,
  getWorstSeverity,
  splitImageReference,
} from '../core';
import { SeverityDot, scoreBarColor, scoreColor } from './primitives';

interface ProjectOverviewProps {
  model: ComposeModel;
  findings: Finding[];
  score: SecurityScoreSummary;
  onSelectService: (serviceName: string) => void;
}

function isPublic(hostIp?: string): boolean {
  if (!hostIp) return true;
  const ip = hostIp.trim().replace(/^\[|\]$/g, '');
  return ip === '' || ip === '0.0.0.0' || ip === '::' || /:-(0\.0\.0\.0|::)?\}$/.test(ip);
}

function ScoreBar({ score }: { score: number }) {
  return (
    <span className="relative block h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(2, score)}%`, backgroundColor: scoreBarColor(score) }}
      />
    </span>
  );
}

function Section({
  title,
  aside,
  note,
  children,
}: {
  title: string;
  aside?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 py-4 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className={`flex items-baseline justify-between ${note ? 'mb-1' : 'mb-3'}`}>
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{title}</h3>
        {aside && <span className="text-xs text-[var(--text-muted)]">{aside}</span>}
      </div>
      {note && <p className="mb-3 text-xs text-[var(--text-muted)] leading-snug">{note}</p>}
      {children}
    </section>
  );
}

/**
 * Project-level view shown when nothing is selected in the diagram:
 * where the score comes from, which services drag it down, and what the
 * stack exposes to the host and the network.
 */
export function ProjectOverview({ model, findings, score, onSelectService }: ProjectOverviewProps) {
  const services = Object.values(model.services);

  const exposure = useMemo(() => {
    let publicPorts = 0;
    let loopbackPorts = 0;
    let bindMounts = 0;
    let writableBinds = 0;
    let namedVolumes = 0;
    let hostNamespace = 0;
    for (const svc of services) {
      const hostNet = svc.networkMode?.trim() === 'host';
      if (!hostNet) {
        for (const p of svc.ports) {
          if (isPublic(p.hostIp)) publicPorts++;
          else loopbackPorts++;
        }
      }
      for (const m of svc.volumes) {
        if (m.type === 'bind') {
          bindMounts++;
          if (!m.readOnly) writableBinds++;
        } else if (m.type === 'volume') {
          namedVolumes++;
        }
      }
      if (
        svc.privileged === true ||
        [svc.networkMode, svc.pid, svc.ipc, svc.uts, svc.usernsMode, svc.cgroup].some(
          (v) => v?.trim().toLowerCase() === 'host',
        )
      ) {
        hostNamespace++;
      }
    }
    const count = (ruleId: string) => findings.filter((f) => f.ruleId === ruleId).length;
    return [
      { label: 'Published on all interfaces', value: publicPorts, risk: publicPorts > 0 },
      { label: 'Published on loopback', value: loopbackPorts, risk: false },
      { label: 'Privileged or host-namespaced', value: hostNamespace, risk: hostNamespace > 0 },
      { label: 'Runtime socket mounts', value: count('CMP002'), risk: count('CMP002') > 0 },
      { label: 'Secrets in the file', value: count('CMP012'), risk: count('CMP012') > 0 },
      { label: 'Host bind mounts', value: bindMounts, detail: writableBinds > 0 ? `${writableBinds} writable` : undefined, risk: false },
      { label: 'Named volumes', value: namedVolumes, risk: false },
      {
        label: 'Networks',
        value: Object.values(model.networks).filter((n) => !n.implicit || n.name === 'default').length,
        detail: Object.values(model.networks).some((n) => n.internal)
          ? `${Object.values(model.networks).filter((n) => n.internal).length} internal`
          : undefined,
        risk: false,
      },
    ];
  }, [services, findings, model.networks]);

  const serviceRows = services
    .map((svc) => {
      const svcFindings = findings.filter((f) => f.service === svc.name);
      const { imageName, imageTag } = splitImageReference(svc.image, svc.build?.context);
      return {
        name: svc.name,
        image: svc.image ? `${imageName}:${imageTag}` : imageName,
        score: score.serviceScores[svc.name] ?? 100,
        worst: getWorstSeverity(svcFindings),
        count: svcFindings.filter((f) => f.severity !== 'info').length,
      };
    })
    .sort((a, b) => a.score - b.score);

  return (
    <div className="flex-1 overflow-y-auto">
      <Section
        title="Score by area"
        note="Share of services without issues in each area, weighted by how severe the worst issue is."
      >
        <ul className="space-y-2.5">
          {CATEGORY_ORDER.map((category) => {
            const cat = score.categoryScores[category];
            return (
              <li key={category} title={CATEGORY_DESCRIPTIONS[category]} className="grid grid-cols-[1fr_88px_28px] items-center gap-3">
                <span className="min-w-0">
                  <span className="block text-[13px] text-[var(--text-primary)] truncate">{CATEGORY_LABELS[category]}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {cat.findings === 0 ? 'No findings' : `${cat.findings} finding${cat.findings === 1 ? '' : 's'}`}
                  </span>
                </span>
                <ScoreBar score={cat.score} />
                <span className="text-right text-[13px] font-medium tabular" style={{ color: scoreColor(cat.score) }}>
                  {cat.score}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Services" aside="weakest first">
        <ul className="-mx-2">
          {serviceRows.map((row) => (
            <li key={row.name}>
              <button
                type="button"
                onClick={() => onSelectService(row.name)}
                className="w-full px-2 py-2 rounded-md text-left grid grid-cols-[1fr_auto] items-center gap-3 hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    {row.worst !== 'none' && row.worst !== 'info' && <SeverityDot severity={row.worst} />}
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{row.name}</span>
                  </span>
                  <span className="block font-mono text-[11px] text-[var(--text-muted)] truncate">{row.image}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[13px] font-medium tabular" style={{ color: scoreColor(row.score) }}>
                    {row.score}
                  </span>
                  <span className="block text-[11px] text-[var(--text-muted)] tabular">
                    {row.count === 0 ? 'clean' : `${row.count} issue${row.count === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Exposure">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[13px]">
          {exposure.map((item) => (
            <div key={item.label} className="contents">
              <dt className="text-[var(--text-secondary)]">{item.label}</dt>
              <dd className="text-right tabular">
                <span
                  className={item.value === 0 ? 'text-[var(--text-muted)]' : 'font-medium'}
                  style={item.risk ? { color: 'var(--sev-high-fg)' } : undefined}
                >
                  {item.value}
                </span>
                {item.detail && <span className="ml-1.5 text-xs text-[var(--text-muted)]">{item.detail}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
