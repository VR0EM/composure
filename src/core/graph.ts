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
  /** Host side of the mapping, e.g. `0.0.0.0:8080`. */
  exposureLabel: string;
  /** Container side, e.g. `80` or `53/udp`. */
  containerLabel: string;
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
  /** Plain-language explanation shown when hovering the connection. */
  detail: { title: string; text: string };
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

/** `name:tag`, or `name@digest` for pinned images. */
export function formatImageReference(ref: { imageName: string; imageTag: string }): string {
  return ref.imageTag.startsWith('@') ? `${ref.imageName}${ref.imageTag}` : `${ref.imageName}:${ref.imageTag}`;
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

/*
 * Node sizes. Text is estimated from the Geist metrics used in the UI so nodes
 * are wide enough for their content.
 */
const MONO_12 = 7.25; // Geist Mono 12px: 0.6em per glyph, plus a little slack
const SANS_13_SEMIBOLD = 7.6;
const NODE_PADDING_X = 30; // 14px padding each side plus the border

export const SERVICE_NODE = { minWidth: 168, maxWidth: 288, height: 58 } as const;
export const PORT_NODE = { minWidth: 152, maxWidth: 260, height: 50 } as const;
export const RESOURCE_NODE = { minWidth: 140, maxWidth: 280, height: 50 } as const;

/** Longest host path shown in full; longer paths keep their start and end. */
const MAX_PATH_CHARS = 34;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.ceil(value)));
}

/** Shorten long host paths in the middle so both the root and the file stay visible. */
export function shortenHostPath(hostPath: string, maxChars = MAX_PATH_CHARS): string {
  const path = hostPath.trim();
  if (path.length <= maxChars) return path;
  const segments = path.split('/');
  const last = segments[segments.length - 1] ?? '';
  const head = path.startsWith('/') ? `/${segments[1] ?? ''}` : segments[0] ?? '';
  const candidate = `${head}/…/${last}`;
  if (candidate.length <= maxChars) {
    // Add parent folders back while they fit
    let tail = last;
    for (let i = segments.length - 2; i > 1; i--) {
      const next = `${segments[i]}/${tail}`;
      if (`${head}/…/${next}`.length > maxChars) break;
      tail = next;
    }
    return `${head}/…/${tail}`;
  }
  return `…${path.slice(path.length - maxChars + 1)}`;
}

export function portContainerLabel(port: PortMapping): string {
  return `${port.target}${port.protocol !== 'tcp' ? `/${port.protocol}` : ''}`;
}

export function portNodeTitle(data: Pick<HostPortNodeData, 'exposureLabel' | 'containerLabel'>): string {
  return `${data.exposureLabel} → ${data.containerLabel}`;
}

function resourceTitle(data: DiagramNodeData): string {
  switch (data.kind) {
    case 'network':
      return data.network.name;
    case 'volume':
      return data.volume.name.startsWith('anon:') ? data.volume.name.split(':').slice(2).join(':') : data.volume.name;
    case 'bindMount':
      return shortenHostPath(data.hostPath);
    default:
      return '';
  }
}

/** Size every node to fit its own text (within limits). The layout can align a column afterwards. */
function sizeNodes(nodes: DiagramNode[]): void {
  for (const n of nodes) {
    const data = n.data;
    if (data.kind === 'service') {
      const badge = data.findingsCount > 0 ? 34 : 0;
      const name = data.service.name.length * SANS_13_SEMIBOLD + badge;
      const image = formatImageReference(data).length * MONO_12;
      n.width = clamp(Math.max(name, image) + NODE_PADDING_X, SERVICE_NODE.minWidth, SERVICE_NODE.maxWidth);
      n.height = SERVICE_NODE.height;
    } else if (data.kind === 'hostPort') {
      n.width = clamp(portNodeTitle(data).length * MONO_12 + NODE_PADDING_X, PORT_NODE.minWidth, PORT_NODE.maxWidth);
      n.height = PORT_NODE.height;
    } else {
      const perChar = data.kind === 'bindMount' ? MONO_12 : SANS_13_SEMIBOLD;
      n.width = clamp(resourceTitle(data).length * perChar + NODE_PADDING_X, RESOURCE_NODE.minWidth, RESOURCE_NODE.maxWidth);
      n.height = RESOURCE_NODE.height;
    }
  }
}

const DEPENDS_CONDITION_TEXT: Record<string, string> = {
  service_healthy: 'Waits until it reports healthy.',
  service_completed_successfully: 'Waits until it has run to completion.',
  service_started: 'Waits until it has started.',
};

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

    nodes.push({
      id: serviceNodeId,
      kind: 'service',
      width: SERVICE_NODE.minWidth,
      height: SERVICE_NODE.height,
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
      const pubPort = port.published ?? 'random';
      const protoSuffix = port.protocol !== 'tcp' ? `/${port.protocol}` : '';
      const exposureLabel = `${hostBind}${pubPort}`;
      const containerLabel = portContainerLabel(port);

      nodes.push({
        id: portNodeId,
        kind: 'hostPort',
        width: PORT_NODE.minWidth,
        height: PORT_NODE.height,
        data: {
          kind: 'hostPort',
          serviceName: service.name,
          port,
          exposureLabel,
          containerLabel,
          isPublicInternet,
        },
      });

      edges.push({
        id: `edge:port:${service.name}:${idx}`,
        source: portNodeId,
        target: serviceNodeId,
        kind: 'port',
        label: `:${port.target}${protoSuffix}`,
        detail: {
          title: `${exposureLabel} → ${service.name}:${containerLabel}`,
          text: isPublicInternet
            ? 'Published on every network interface of the host.'
            : 'Only reachable from the host itself.',
        },
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
        detail: {
          title: `${service.name} → ${net.name}`,
          text: net.ipv4Address
            ? `Attached to the network with fixed address ${net.ipv4Address}.`
            : 'Attached to the network; reachable by service name from other members.',
        },
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
          detail: {
            title: `${service.name} → ${mount.source}`,
            text: `Host folder mounted at ${mount.target}, ${mount.readOnly ? 'read-only' : 'read-write'}.`,
          },
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
          detail: {
            title: `${service.name} → ${mount.source ?? 'anonymous volume'}`,
            text: `Volume mounted at ${mount.target}, ${mount.readOnly ? 'read-only' : 'read-write'}.`,
          },
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
        detail: {
          title: `${service.name} → ${sharedNetworkTarget}`,
          text: `Uses the network stack of ${sharedNetworkTarget} (network_mode: service).`,
        },
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
          detail: {
            title: `${service.name} depends on ${dep.target}`,
            text: DEPENDS_CONDITION_TEXT[dep.condition ?? 'service_started'] ?? `Condition: ${dep.condition}.`,
          },
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
      width: RESOURCE_NODE.minWidth,
      height: RESOURCE_NODE.height,
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
      width: RESOURCE_NODE.minWidth,
      height: RESOURCE_NODE.height,
      data: {
        kind: 'volume',
        volume: declaredVol,
        mounts,
      },
    });
  }

  // 4. Bind Mount nodes
  for (const [hostPath, info] of bindMountsMap.entries()) {
    nodes.push({
      id: `bind:${hostPath}`,
      kind: 'bindMount',
      width: RESOURCE_NODE.minWidth,
      height: RESOURCE_NODE.height,
      data: {
        kind: 'bindMount',
        hostPath,
        line: info.line,
        mounts: info.mounts,
      },
    });
  }

  sizeNodes(nodes);
  return { nodes, edges };
}
