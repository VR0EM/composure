import { ComposeModel, Finding, Rule } from '../types';

function extractTag(image: string): {
  hasDigest: boolean;
  baseImage: string;
  tag: string | null;
} {
  const trimmed = image.trim();
  if (trimmed.includes('@sha256:')) {
    return { hasDigest: true, baseImage: trimmed, tag: null };
  }

  let colonIdx = -1;
  let braceDepth = 0;
  const lastSlash = trimmed.lastIndexOf('/');
  for (let i = Math.max(0, lastSlash + 1); i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}' && braceDepth > 0) braceDepth--;
    else if (ch === ':' && braceDepth === 0) {
      colonIdx = i;
      break;
    }
  }

  if (colonIdx === -1) {
    return { hasDigest: false, baseImage: trimmed, tag: null };
  }

  const baseImage = trimmed.slice(0, colonIdx);
  const tag = trimmed.slice(colonIdx + 1).trim();
  return {
    hasDigest: false,
    baseImage,
    tag: tag.length > 0 ? tag : null,
  };
}

function buildFix(serviceName: string, baseImage = 'nginx', tag = '1.27-alpine'): string {
  const cleanTag = tag === 'latest' ? '1.0.0' : tag;
  return `Pin the image to an explicit version tag and SHA256 digest:
\`\`\`yaml
services:
  ${serviceName}:
    image: ${baseImage}:${cleanTag}@sha256:<digest>
\`\`\``;
}

export const CMP003: Rule = {
  id: 'CMP003',
  title: 'Unpinned image tag',
  severity: 'medium',
  description:
    'Mutable tags can pull different code on each deploy; pin a version and `@sha256` digest.',
  fix: buildFix('app'),
  references: [
    {
      title: 'CIS Docker Benchmark 4.7: Avoid using the :latest tag',
      url: 'https://www.cisecurity.org/benchmark/docker',
    },
    {
      title: 'Docker Docs: Pull an image by digest',
      url: 'https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (!service.image) continue;
      const line = service.imageLine ?? service.line;
      const { hasDigest, baseImage, tag } = extractTag(service.image);

      if (hasDigest) {
        continue;
      }

      if (tag === null || tag.toLowerCase() === 'latest') {
        findings.push({
          ruleId: this.id,
          title: 'Image uses :latest',
          severity: 'medium',
          service: service.name,
          line,
          description: this.description,
          message:
            tag === null
              ? `Image \`${service.image}\` omits a version tag.`
              : `Image \`${service.image}\` uses the mutable \`:latest\` tag.`,
          fix: buildFix(service.name, baseImage, '1.0.0'),
          references: this.references,
        });
      } else {
        findings.push({
          ruleId: this.id,
          title: 'No image digest set',
          severity: 'info',
          service: service.name,
          line,
          description: this.description,
          message: `Image \`${service.image}\` is not pinned by an \`@sha256\` digest.`,
          fix: buildFix(service.name, baseImage, tag),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
