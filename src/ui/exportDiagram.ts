import { ComposeGraph, DiagramEdge, Severity } from '../core';
import {
  LayoutDirection,
  buildRoundedPath,
  layoutComposeGraphBoth,
  polylineMidpoint,
} from './diagram/layoutGraph';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

interface SvgThemeColors {
  bg: string;
  gridDot: string;
  headerBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  badgeBg: string;

  // Node surfaces
  nodeServiceBg: string;
  nodeServiceBorder: string;

  // Severities
  sevCriticalBorder: string;
  sevHighBorder: string;
  sevMediumBorder: string;
  sevLowBorder: string;
  sevInfoBorder: string;

  // Node Types
  nodePortBg: string;
  nodePortBorder: string;
  nodePortFg: string;

  nodeNetworkBg: string;
  nodeNetworkBorder: string;
  nodeNetworkFg: string;

  nodeVolumeBg: string;
  nodeVolumeBorder: string;
  nodeVolumeFg: string;

  nodeBindBg: string;
  nodeBindBorder: string;
  nodeBindFg: string;

  edgeDepends: string;
  labelBg: string;
  labelBorder: string;
}

const THEMES: Record<'dark' | 'light', SvgThemeColors> = {
  dark: {
    bg: '#0f1117',
    gridDot: '#222734',
    headerBorder: '#232936',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    accent: '#2dd4bf',
    badgeBg: '#1e2430',

    nodeServiceBg: '#161b24',
    nodeServiceBorder: '#2e3848',

    sevCriticalBorder: '#ef4444',
    sevHighBorder: '#f97316',
    sevMediumBorder: '#f59e0b',
    sevLowBorder: '#3b82f6',
    sevInfoBorder: '#64748b',

    nodePortBg: '#221524',
    nodePortBorder: '#ec4899',
    nodePortFg: '#f472b6',

    nodeNetworkBg: '#1c182e',
    nodeNetworkBorder: '#8b5cf6',
    nodeNetworkFg: '#a78bfa',

    nodeVolumeBg: '#12241d',
    nodeVolumeBorder: '#10b981',
    nodeVolumeFg: '#34d399',

    nodeBindBg: '#241e16',
    nodeBindBorder: '#d97706',
    nodeBindFg: '#fbbf24',

    edgeDepends: '#64748b',
    labelBg: '#161b24',
    labelBorder: '#2e3848',
  },
  light: {
    bg: '#f8fafc',
    gridDot: '#cbd5e1',
    headerBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    accent: '#0d9488',
    badgeBg: '#f1f5f9',

    nodeServiceBg: '#ffffff',
    nodeServiceBorder: '#cbd5e1',

    sevCriticalBorder: '#dc2626',
    sevHighBorder: '#ea580c',
    sevMediumBorder: '#d97706',
    sevLowBorder: '#2563eb',
    sevInfoBorder: '#64748b',

    nodePortBg: '#fdf2f8',
    nodePortBorder: '#db2777',
    nodePortFg: '#be185d',

    nodeNetworkBg: '#f5f3ff',
    nodeNetworkBorder: '#7c3aed',
    nodeNetworkFg: '#6d28d9',

    nodeVolumeBg: '#ecfdf5',
    nodeVolumeBorder: '#059669',
    nodeVolumeFg: '#047857',

    nodeBindBg: '#fffbeb',
    nodeBindBorder: '#b45309',
    nodeBindFg: '#92400e',

    edgeDepends: '#64748b',
    labelBg: '#ffffff',
    labelBorder: '#cbd5e1',
  },
};

function getSeverityBorder(sev: Severity | 'none', colors: SvgThemeColors): string {
  switch (sev) {
    case 'critical':
      return colors.sevCriticalBorder;
    case 'high':
      return colors.sevHighBorder;
    case 'medium':
      return colors.sevMediumBorder;
    case 'low':
      return colors.sevLowBorder;
    case 'info':
      return colors.sevInfoBorder;
    default:
      return colors.nodeServiceBorder;
  }
}

function getEdgeColor(edge: DiagramEdge, colors: SvgThemeColors): {
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  markerId: string;
} {
  switch (edge.kind) {
    case 'dependsOn':
      return {
        stroke: colors.edgeDepends,
        strokeWidth: 1.5,
        dashed: true,
        markerId: 'arrow-depends',
      };
    case 'port':
      return {
        stroke: colors.nodePortBorder,
        strokeWidth: 1.75,
        dashed: false,
        markerId: 'arrow-port',
      };
    case 'network':
      return {
        stroke: colors.nodeNetworkBorder,
        strokeWidth: 1.75,
        dashed: false,
        markerId: 'arrow-network',
      };
    case 'volume': {
      const isBind = edge.target.startsWith('bind:');
      return {
        stroke: isBind ? colors.nodeBindBorder : colors.nodeVolumeBorder,
        strokeWidth: edge.readOnly ? 1.25 : 1.75,
        dashed: false,
        markerId: isBind ? 'arrow-bind' : 'arrow-volume',
      };
    }
  }
}

export async function renderGraphToSvgString(
  graph: ComposeGraph,
  theme: 'dark' | 'light' = 'dark',
  preferredDirection?: LayoutDirection,
): Promise<{ svg: string; width: number; height: number }> {
  const colors = THEMES[theme] ?? THEMES.dark;

  // Compute layouts in both directions and pick the most balanced aspect ratio
  const layouts = await layoutComposeGraphBoth(graph);
  let direction: LayoutDirection = preferredDirection ?? 'DOWN';

  if (!preferredDirection) {
    const rRight = layouts.RIGHT.bounds.width / Math.max(1, layouts.RIGHT.bounds.height);
    const rDown = layouts.DOWN.bounds.width / Math.max(1, layouts.DOWN.bounds.height);
    // Ideal diagram ratio is between 1.2 and 1.8. If RIGHT is a stretched ribbon (> 2.2), prefer DOWN.
    if (rRight > 2.2 && rDown >= 1.0) {
      direction = 'DOWN';
    } else if (Math.abs(rDown - 1.5) < Math.abs(rRight - 1.5)) {
      direction = 'DOWN';
    } else {
      direction = 'RIGHT';
    }
  }

  const { nodes, edges, bounds } = layouts[direction];

  const PAD_X = 48;
  const PAD_TOP = 72; // Space for header branding
  const PAD_BOTTOM = 48;

  const offsetX = PAD_X - bounds.x;
  const offsetY = PAD_TOP - bounds.y;

  const totalWidth = Math.max(680, Math.ceil(bounds.width + PAD_X * 2));
  const totalHeight = Math.max(400, Math.ceil(bounds.height + PAD_TOP + PAD_BOTTOM));

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">`,
  );

  // Embedded Defs: Styles, Web Fonts, Markers, Filters, Patterns
  parts.push(`  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500;600&amp;display=swap');
      text {
        font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .mono {
        font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    </style>

    <!-- Canvas Dot Grid Pattern -->
    <pattern id="canvas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="${colors.gridDot}" />
    </pattern>

    <!-- Card Drop Shadow -->
    <filter id="node-shadow" x="-12%" y="-15%" width="124%" height="130%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="${
        theme === 'dark' ? '0.5' : '0.1'
      }" />
    </filter>

    <!-- Arrow Markers -->
    <marker id="arrow-port" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${colors.nodePortBorder}" />
    </marker>
    <marker id="arrow-network" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${colors.nodeNetworkBorder}" />
    </marker>
    <marker id="arrow-volume" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${colors.nodeVolumeBorder}" />
    </marker>
    <marker id="arrow-bind" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${colors.nodeBindBorder}" />
    </marker>
    <marker id="arrow-depends" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${colors.edgeDepends}" />
    </marker>
  </defs>`);

  // Background Canvas
  parts.push(`  <!-- Background -->
  <rect width="${totalWidth}" height="${totalHeight}" fill="${colors.bg}" />
  <rect width="${totalWidth}" height="${totalHeight}" fill="url(#canvas-grid)" />`);

  // Header Bar Branding
  const serviceCount = graph.nodes.filter((n) => n.kind === 'service').length;
  const portCount = graph.nodes.filter((n) => n.kind === 'hostPort').length;
  const netCount = graph.nodes.filter((n) => n.kind === 'network').length;
  const volCount = graph.nodes.filter((n) => n.kind === 'volume' || n.kind === 'bindMount').length;

  parts.push(`  <!-- Header Branding -->
  <g transform="translate(36, 26)">
    <!-- Container Icon -->
    <rect x="0" y="0" width="22" height="22" rx="5" fill="${colors.nodeServiceBg}" stroke="${colors.nodeServiceBorder}" stroke-width="1" />
    <rect x="4" y="4" width="6" height="6" rx="1" fill="${colors.accent}" />
    <rect x="12" y="4" width="6" height="6" rx="1" fill="${colors.accent}" fill-opacity="0.75" />
    <rect x="4" y="12" width="6" height="6" rx="1" fill="${colors.accent}" fill-opacity="0.75" />
    <rect x="12" y="12" width="6" height="6" rx="1" fill="${colors.accent}" fill-opacity="0.35" />

    <text x="32" y="15" fill="${colors.textPrimary}" font-size="14" font-weight="700" letter-spacing="-0.3">Composure</text>
    <text x="116" y="15" fill="${colors.textMuted}" font-size="12" font-weight="600">COMPOSURE ARCHITECTURE DIAGRAM</text>
    <text x="${totalWidth - 72}" y="15" text-anchor="end" fill="${colors.textSecondary}" font-size="11" class="mono">${serviceCount} services · ${portCount} ports · ${netCount} nets · ${volCount} vols</text>
  </g>
  <line x1="36" y1="56" x2="${totalWidth - 36}" y2="56" stroke="${colors.headerBorder}" stroke-width="1" />`);

  // Render Edges
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  parts.push(`  <!-- Edges -->
  <g class="edges">`);

  const edgeLabelsToRender: Array<{
    mid: { x: number; y: number };
    label: string;
    isMono: boolean;
  }> = [];

  for (const flowEdge of edges) {
    const edge = edgeById.get(flowEdge.id);
    const points = flowEdge.data?.points;
    if (!edge || !points || points.length < 2) continue;

    const shifted = points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
    const { stroke, strokeWidth, dashed, markerId } = getEdgeColor(edge, colors);
    const dashAttr = dashed ? ' stroke-dasharray="4 4"' : '';
    const pathD = buildRoundedPath(shifted, 10);

    parts.push(
      `    <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} marker-end="url(#${markerId})" />`,
    );

    // Save label if informative
    if (edge.label && edge.label !== 'depends_on') {
      const mid = polylineMidpoint(shifted);
      edgeLabelsToRender.push({
        mid,
        label: edge.label,
        isMono: edge.kind === 'port' || edge.label.startsWith(':'),
      });
    }
  }
  parts.push(`  </g>`);

  // Render Nodes
  parts.push(`  <!-- Nodes -->
  <g class="nodes">`);

  for (const flowNode of nodes) {
    const orig = graph.nodes.find((n) => n.id === flowNode.id);
    const w = orig?.width ?? 172;
    const h = orig?.height ?? 54;
    const x = flowNode.position.x + offsetX;
    const y = flowNode.position.y + offsetY;
    const data = flowNode.data;

    if (data.kind === 'service') {
      const borderStroke = getSeverityBorder(data.worstSeverity, colors);
      const title = data.service.name;
      const subtitle = `${data.imageName}:${data.imageTag}`;

      parts.push(`    <g transform="translate(${x}, ${y})" filter="url(#node-shadow)">
      <rect width="${w}" height="${h}" rx="8" fill="${colors.nodeServiceBg}" stroke="${borderStroke}" stroke-width="1.5" />
      <text x="14" y="24" fill="${colors.textPrimary}" font-size="13" font-weight="600">${escapeXml(truncateText(title, 22))}</text>
      <!-- Image tag pill -->
      <rect x="12" y="32" width="${w - 24}" height="20" rx="4" fill="${colors.badgeBg}" />
      <text x="18" y="46" fill="${colors.textSecondary}" font-size="11" class="mono">${escapeXml(truncateText(subtitle, 24))}</text>
    </g>`);
    } else {
      let typeLabel = 'node';
      let title = '';
      let isMono = false;
      let bg = colors.nodeNetworkBg;
      let border = colors.nodeNetworkBorder;
      let fg = colors.nodeNetworkFg;

      if (data.kind === 'hostPort') {
        typeLabel = 'PORT';
        title = data.exposureLabel;
        isMono = true;
        bg = colors.nodePortBg;
        border = colors.nodePortBorder;
        fg = colors.nodePortFg;
      } else if (data.kind === 'network') {
        typeLabel = 'NETWORK';
        title = data.network.name;
        bg = colors.nodeNetworkBg;
        border = colors.nodeNetworkBorder;
        fg = colors.nodeNetworkFg;
      } else if (data.kind === 'volume') {
        typeLabel = 'VOLUME';
        title = data.volume.name.startsWith('anon:')
          ? data.volume.name.split(':').slice(2).join(':')
          : data.volume.name;
        bg = colors.nodeVolumeBg;
        border = colors.nodeVolumeBorder;
        fg = colors.nodeVolumeFg;
      } else if (data.kind === 'bindMount') {
        const allRo = data.mounts.length > 0 && data.mounts.every((m) => m.readOnly);
        const allRw = data.mounts.length > 0 && data.mounts.every((m) => !m.readOnly);
        const modeLabel = allRo ? 'ro' : allRw ? 'rw' : 'rw/ro';
        typeLabel = `MOUNT (${modeLabel})`;
        const segments = data.hostPath
          .trim()
          .split('/')
          .filter((s) => s.length > 0 && s !== '.');
        title =
          segments.length >= 2
            ? `${segments[segments.length - 2]}/${segments[segments.length - 1]}`
            : data.hostPath.trim() || data.hostPath;
        isMono = true;
        bg = colors.nodeBindBg;
        border = colors.nodeBindBorder;
        fg = colors.nodeBindFg;
      }

      const fontClass = isMono ? ' class="mono"' : '';

      parts.push(`    <g transform="translate(${x}, ${y})" filter="url(#node-shadow)">
      <rect width="${w}" height="${h}" rx="8" fill="${bg}" stroke="${border}" stroke-width="1.25" />
      <text x="12" y="20" fill="${fg}" font-size="10" font-weight="700" letter-spacing="0.5">${escapeXml(typeLabel)}</text>
      <text x="12" y="38" fill="${colors.textPrimary}" font-size="12" font-weight="500"${fontClass}>${escapeXml(truncateText(title, 22))}</text>
    </g>`);
    }
  }
  parts.push(`  </g>`);

  // Render Edge Labels on top
  if (edgeLabelsToRender.length > 0) {
    parts.push(`  <!-- Edge Labels -->
  <g class="edge-labels">`);
    for (const item of edgeLabelsToRender) {
      const textLen = item.label.length;
      const boxW = Math.max(30, textLen * 7 + 12);
      const boxH = 18;
      const fontClass = item.isMono ? ' class="mono"' : '';
      parts.push(`    <g transform="translate(${Math.round(item.mid.x)}, ${Math.round(item.mid.y)})">
      <rect x="-${boxW / 2}" y="-${boxH / 2}" width="${boxW}" height="${boxH}" rx="4" fill="${colors.labelBg}" stroke="${colors.labelBorder}" stroke-width="1" />
      <text x="0" y="3.5" text-anchor="middle" font-size="10" font-weight="500" fill="${colors.textSecondary}"${fontClass}>${escapeXml(item.label)}</text>
    </g>`);
    }
    parts.push(`  </g>`);
  }

  // Footer Watermark
  parts.push(`  <!-- Footer -->
  <text x="${totalWidth - 36}" y="${totalHeight - 16}" text-anchor="end" fill="${colors.textMuted}" font-size="10">Generated with Composure · 100% Client-Side</text>`);

  parts.push('</svg>');
  return { svg: parts.join('\n'), width: totalWidth, height: totalHeight };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportDiagramAsSvg(
  graph: ComposeGraph,
  theme: 'dark' | 'light',
  direction?: LayoutDirection,
): Promise<void> {
  const { svg } = await renderGraphToSvgString(graph, theme, direction);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, 'composure-diagram.svg');
}

export async function exportDiagramAsPng(
  graph: ComposeGraph,
  theme: 'dark' | 'light',
  direction?: LayoutDirection,
): Promise<void> {
  const { svg, width, height } = await renderGraphToSvgString(graph, theme, direction);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          triggerDownload(pngBlob, 'composure-diagram.png');
          resolve();
        } else {
          reject(new Error('Failed to encode PNG'));
        }
      }, 'image/png');
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/markdown;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType });
  triggerDownload(blob, filename);
}
