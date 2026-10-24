import { ComposeModel, Finding, Rule } from '../types';
import { fixWithYaml } from './shared';

export interface ImageReferenceParts {
  hasDigest: boolean;
  baseImage: string;
  /** Tag as written, or null when omitted */
  tag: string | null;
  /** Tag after resolving a `${VAR:-default}` fallback, or null when unknown */
  effectiveTag: string | null;
  /** True when the whole reference is a variable such as `${IMAGE}` */
  fullyInterpolated: boolean;
}

export function parseImageReference(image: string): ImageReferenceParts {
  const trimmed = image.trim();
  const fullyInterpolated = /^\$\{[^}]+\}$/.test(trimmed) || /^\$[A-Za-z_]\w*$/.test(trimmed);
  if (/@sha256:/i.test(trimmed)) {
    return {
      hasDigest: true,
      baseImage: trimmed.split('@')[0] ?? trimmed,
      tag: null,
      effectiveTag: null,
      fullyInterpolated,
    };
  }

  // Find the tag colon after the last slash (so `registry:5000/app` is not split),
  // ignoring colons inside `${...}` interpolations.
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
    return { hasDigest: false, baseImage: trimmed, tag: null, effectiveTag: null, fullyInterpolated };
  }

  const baseImage = trimmed.slice(0, colonIdx);
  const tag = trimmed.slice(colonIdx + 1).trim() || null;
  let effectiveTag = tag;
  if (tag) {
    const fallback = /^\$\{[A-Za-z_]\w*:?-([^}]*)\}$/.exec(tag);
    if (fallback) {
      effectiveTag = fallback[1] || null;
    } else if (tag.includes('$')) {
      effectiveTag = null;
    }
  }
  return { hasDigest: false, baseImage, tag, effectiveTag, fullyInterpolated };
}

function buildFix(serviceName: string, baseImage: string, tag: string | null): string {
  const exampleTag = tag && tag.toLowerCase() !== 'latest' && !tag.includes('$') ? tag : '<version>';
  return fixWithYaml(
    'Pin an explicit version tag and its SHA256 digest. Get the digest with `docker buildx imagetools inspect <image>:<tag>`:',
    `
services:
  ${serviceName}:
    image: ${baseImage}:${exampleTag}@sha256:<digest>`,
  );
}

export const CMP003: Rule = {
  id: 'CMP003',
  title: 'Unpinned image tag',
  severity: 'medium',
  description:
    'Mutable tags can pull different code on each deploy; pin a version and `@sha256` digest.',
  fix: buildFix('app', 'nginx', '1.27-alpine'),
  references: [
    {
      title: 'Docker Docs: Pull an image by digest',
      url: 'https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier',
    },
    {
      title: 'Docker Docs: Image tags and digests in Compose',
      url: 'https://docs.docker.com/reference/compose-file/services/#image',
    },
  ],
  check(model: ComposeModel): Finding[] {
    const findings: Finding[] = [];

    for (const service of Object.values(model.services)) {
      if (!service.image) continue;
      const line = service.imageLine ?? service.line;
      const ref = parseImageReference(service.image);
      // A fully interpolated reference (`image: ${IMAGE}`) cannot be judged statically
      if (ref.hasDigest || ref.fullyInterpolated) continue;

      const unpinned =
        ref.tag === null || (ref.effectiveTag !== null && ref.effectiveTag.toLowerCase() === 'latest');

      if (unpinned) {
        let message: string;
        if (ref.tag === null) {
          message = `Image \`${service.image}\` omits a tag, so Docker pulls \`:latest\`.`;
        } else if (ref.tag.includes('$')) {
          message = `Image \`${service.image}\` falls back to \`:latest\` when the variable is unset.`;
        } else {
          message = `Image \`${service.image}\` uses the mutable \`:latest\` tag.`;
        }
        findings.push({
          ruleId: this.id,
          title: 'Image uses :latest',
          severity: 'medium',
          service: service.name,
          line,
          description: this.description,
          message,
          fix: buildFix(service.name, ref.baseImage, null),
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
          fix: buildFix(service.name, ref.baseImage, ref.effectiveTag),
          references: this.references,
        });
      }
    }

    return findings;
  },
};
