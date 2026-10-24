import {
  ComposeModel,
  Finding,
  NormalizedNetwork,
  NormalizedService,
  NormalizedVolume,
  PortMapping,
  Severity,
  VolumeMount,
} from './types';

export type DiagramNodeKind =
  | 'service'
  | 'network'
  | 'volume'
  | 'bindMount'
  | 'hostPort';

export interface ServiceNodeData extends Record<string, unknown> {
  kind: 'service';
  service: NormalizedService;
  imageName: string;
  imageTag: string;
  worstSeverity: Severity | 'none';
  findingsCount: number;
  findings: Finding[];
}

export interface NetworkNodeData extends Record<string, unknown> {
  kind: 'network';
  network: NormalizedNetwork;
  connectedServices: string[];
}

export interface VolumeNodeData extends Record<string, unknown> {
  kind: 'volume';
  volume: NormalizedVolume;
  mounts: Array<{
    service: string;
    target: string;
    readOnly: boolean;
    line: number;
  }>;
}

export interface BindMountNodeData extends Record<string, unknown> {
  kind: 'bindMount';
  hostPath: string;
  line: number;
  mounts: Array<{
    service: string;
    target: string;
    readOnly: boolean;
    line: number;
  }>;
}

export interface HostPortNodeData extends Record<string, unknown> {
  kind: 'hostPort';
  serviceName: string;
  port: PortMapping;
  exposureLabel: string;
  isPublicInternet: boolean;
}

export type DiagramNodeData =
  | ServiceNodeData
  | NetworkNodeData
  | VolumeNodeData
  | BindMountNodeData
  | HostPortNodeData;

export interface DiagramNode {
  id: string;
  kind: DiagramNodeKind;
  width: number;
  height: number;
  data: DiagramNodeData;
}

export type DiagramEdgeKind = 'port' | 'network' | 'networkMode' | 'volume' | 'dependsOn';

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  kind: DiagramEdgeKind;
  label?: string;
  dashed?: boolean;
  readOnly?: boolean;
}

export interface ComposeGraph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * Compute the worst (highest) severity from a list of findings.
 */
export function getWorstSeverity(findings: Finding[]): Severity | 'none' {
  let worst: Severity | 'none' = 'none';
  let highestRank = 0;

  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity];
    if (rank > highestRank) {
      highestRank = rank;
      worst = f.severity;
    }
  }
  return worst;
}

/**
 * Split an image reference into name and tag/digest for display.
 */
export function splitImageReference(
  image?: string,
  buildContext?: string,
): { imageName: string; imageTag: string } {
  if (!image) {
    if (buildContext) {
      return { imageName: `build: ${buildContext}`, imageTag: 'local' };
    }
    return { imageName: 'no-image', imageTag: 'none' };
  }

  // Check digest @sha256:...
  const atIdx = image.indexOf('@');
  if (atIdx !== -1) {
    const beforeAt = image.slice(0, atIdx);
    const digest = image.slice(atIdx + 1);
    const shortDigest = digest.length > 15 ? `${digest.slice(0, 15)}…` : digest;
    return { imageName: beforeAt, imageTag: `@${shortDigest}` };
  }

  // Find colon after the last slash (so registry:port/repo doesn't split on registry port)
  // Also ignore colons inside ${...}
  let colonIdx = -1;
  let braceDepth = 0;
  const lastSlash = image.lastIndexOf('/');
  for (let i = Math.max(0, lastSlash + 1); i < image.length; i++) {
    const ch = image[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}' && braceDepth > 0) braceDepth--;
    else if (ch === ':' && braceDepth === 0) {
      colonIdx = i;
      break;
    }
  }

  if (colonIdx === -1) {
    return { imageName: image, imageTag: 'latest (implicit)' };
  }

  return {
    imageName: image.slice(0, colonIdx),
    imageTag: image.slice(colonIdx + 1) || 'latest',
  };
}

function isLoopbackIp(hostIp?: string): boolean {
  if (!hostIp) return false;
  // `${BIND_IP:-127.0.0.1}`: judge by the fallback value
  const fallback = /^\$\{[A-Za-z_]\w*:?-([^}]*)\}$/.exec(hostIp.trim());
  const trimmed = (fallback ? fallback[1] ?? '' : hostIp).trim().replace(/^\[|\]$/g, '');
  return (
    trimmed === '127.0.0.1' ||
    trimmed.startsWith('127.') ||
    trimmed === '::1' ||
    trimmed === 'localhost'
  );
}

/**
 * Build a pure logical graph of nodes and edges from a normalized ComposeModel
 * and optional security findings.
 */
export function buildComposeGraph(
  model: ComposeModel,
  findings: Finding[] = [],
): ComposeGraph {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const findingsByService = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = findingsByService.get(finding.service) ?? [];
    list.push(finding);
    findingsByService.set(finding.service, list);
  }

  const networkConnections = new Map<string, string[]>();
  const volumeMountsMap = new Map<
    string,
    Array<{ service: string; target: string; readOnly: boolean; line: number }>
  >();
  const bindMountsMap = new Map<
    string,
    {
      line: number;
      mounts: Array<{
        service: string;
        target: string;
        readOnly: boolean;
        line: number;
      }>;
    }
  >();

  // 1. Service nodes and their outgoing/incoming relationships
  for (const service of Object.values(model.services)) {
    const serviceNodeId = `service:${service.name}`;
    const svcFindings = findingsByService.get(service.name) ?? [];
    const { imageName, imageTag } = splitImageReference(
      service.image,
      service.build?.context,
    );

    const worstSeverity = getWorstSeverity(svcFindings);
    const sevBonus: Record<Severity | 'none', { w: number; h: number }> = {
      critical: { w: 24, h: 8 },
      high: { w: 16, h: 6 },
      medium: { w: 10, h: 4 },
      low: { w: 4, h: 2 },
      info: { w: 0, h: 0 },
      none: { w: 0, h: 0 },
    };
    const bonus = sevBonus[worstSeverity];
    const svcWidth = Math.min(
      236,
      172 + bonus.w + Math.min(svcFindings.length * 4, 20),
    );
    const svcHeight = Math.min(
      78,
      54 + bonus.h + Math.min(svcFindings.length * 2, 8),
    );

    nodes.push({
      id: serviceNodeId,
      kind: 'service',
      width: svcWidth,
      height: svcHeight,
      data: {
        kind: 'service',
        service,
        imageName,
        imageTag,
        worstSeverity,
        findingsCount: svcFindings.length,
        findings: svcFindings,
      },
    });

    // Published host ports -> Service
    service.ports.forEach((port, idx) => {
      const portNodeId = `port:${service.name}:${idx}`;
      const isLoopback = isLoopbackIp(port.hostIp);
      const isPublicInternet = !isLoopback;
      const hostBind = port.hostIp ? `${port.hostIp}:` : '0.0.0.0:';
      const pubPort = port.published ?? 'ephemeral';
      const protoSuffix = port.protocol !== 'tcp' ? `/${port.protocol}` : '';

      nodes.push({
        id: portNodeId,
        kind: 'hostPort',
        width: 164,
        height: 48,
        data: {
          kind: 'hostPort',
          serviceName: service.name,
          port,
          exposureLabel: `${hostBind}${pubPort}${protoSuffix}`,
          isPublicInternet,
        },
      });

      edges.push({
        id: `edge:port:${service.name}:${idx}`,
        source: portNodeId,
        target: serviceNodeId,
        kind: 'port',
        label: `:${port.target}${protoSuffix}`,
      });
    });

    // Service -> Networks
    const seenNetworks = new Set<string>();
    for (const net of service.networks) {
      if (seenNetworks.has(net.name)) continue;
      seenNetworks.add(net.name);
      const list = networkConnections.get(net.name) ?? [];
      if (!list.includes(service.name)) {
        list.push(service.name);
      }
      networkConnections.set(net.name, list);

      edges.push({
        id: `edge:net:${service.name}:${net.name}`,
        source: serviceNodeId,
        target: `network:${net.name}`,
        kind: 'network',
        ...(net.ipv4Address ? { label: net.ipv4Address } : {}),
      });
    }

    // Service -> Volumes & Bind Mounts
    service.volumes.forEach((mount: VolumeMount, idx: number) => {
      const rwLabel = mount.readOnly ? 'ro' : 'rw';

      if (mount.type === 'bind' && mount.source) {
        const existing = bindMountsMap.get(mount.source) ?? {
          line: mount.line,
          mounts: [],
        };
        existing.mounts.push({
          service: service.name,
          target: mount.target,
          readOnly: mount.readOnly,
          line: mount.line,
        });
        bindMountsMap.set(mount.source, existing);

        edges.push({
          id: `edge:bind:${service.name}:${idx}:${mount.source}`,
          source: serviceNodeId,
          target: `bind:${mount.source}`,
          kind: 'volume',
          label: rwLabel,
          readOnly: mount.readOnly,
        });
      } else if (mount.type === 'volume') {
        const volName = mount.source ?? `anon:${service.name}:${mount.target}`;
        const list = volumeMountsMap.get(volName) ?? [];
        list.push({
          service: service.name,
          target: mount.target,
          readOnly: mount.readOnly,
          line: mount.line,
        });
        volumeMountsMap.set(volName, list);

        edges.push({
          id: `edge:vol:${service.name}:${idx}:${volName}`,
          source: serviceNodeId,
          target: `volume:${volName}`,
          kind: 'volume',
          label: rwLabel,
          readOnly: mount.readOnly,
        });
      }
    });

    // Service -> Service (network_mode: service:<name> shares that service's network stack)
    const sharedNetworkTarget = service.networkMode?.trim().startsWith('service:')
      ? service.networkMode.trim().slice('service:'.length)
      : undefined;
    if (sharedNetworkTarget && model.services[sharedNetworkTarget]) {
      edges.push({
        id: `edge:netmode:${service.name}:${sharedNetworkTarget}`,
        source: serviceNodeId,
        target: `service:${sharedNetworkTarget}`,
        kind: 'networkMode',
        label: 'shares network',
        dashed: true,
      });
    }

    // Service -> Service (depends_on)
    for (const dep of service.dependsOn) {
      if (model.services[dep.target]) {
        edges.push({
          id: `edge:dep:${service.name}:${dep.target}`,
          source: serviceNodeId,
          target: `service:${dep.target}`,
          kind: 'dependsOn',
          label:
            dep.condition && dep.condition !== 'service_started'
              ? `depends_on (${dep.condition})`
              : 'depends_on',
          dashed: true,
        });
      }
    }
  }

  // 2. Network nodes
  for (const network of Object.values(model.networks)) {
    const connected = networkConnections.get(network.name) ?? [];
    nodes.push({
      id: `network:${network.name}`,
      kind: 'network',
      width: 136,
      height: 48,
      data: {
        kind: 'network',
        network,
        connectedServices: connected,
      },
    });
  }

  // 3. Named (and anonymous) Volume nodes
  const allVolumeNames = new Set<string>([
    ...Object.keys(model.volumes),
    ...Array.from(volumeMountsMap.keys()),
  ]);

  for (const volName of allVolumeNames) {
    const declaredVol: NormalizedVolume = model.volumes[volName] ?? {
      name: volName,
      line: 1,
      implicit: true,
    };
    const mounts = volumeMountsMap.get(volName) ?? [];
    nodes.push({
      id: `volume:${volName}`,
      kind: 'volume',
      width: 144,
      height: 48,
      data: {
        kind: 'volume',
        volume: declaredVol,
        mounts,
      },
    });
  }

  // 4. Bind Mount nodes
  for (const [hostPath, info] of bindMountsMap.entries()) {
    const segments = hostPath
      .trim()
      .split('/')
      .filter((s) => s.length > 0 && s !== '.');
    const shortLabel =
      segments.length >= 2
        ? `${segments[segments.length - 2]}/${segments[segments.length - 1]}`
        : hostPath.trim() || hostPath;
    const bindWidth = Math.min(
      184,
      Math.max(136, Math.round(52 + shortLabel.length * 7.5)),
    );

    nodes.push({
      id: `bind:${hostPath}`,
      kind: 'bindMount',
      width: bindWidth,
      height: 48,
      data: {
        kind: 'bindMount',
        hostPath,
        line: info.line,
        mounts: info.mounts,
      },
    });
  }

  return { nodes, edges };
}
