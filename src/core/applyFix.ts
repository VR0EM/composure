import YAML, { YAMLMap, YAMLSeq } from 'yaml';
import { Finding } from './types';

/**
 * Extracts pure remediation YAML from finding.fix markdown block.
 */
export function extractFixYaml(fix: string): string | null {
  const match = /```yaml\n([\s\S]*?)```/.exec(fix);
  return match ? (match[1] ?? '').trim() : null;
}

/**
 * Applies a finding's remediation YAML directly to the given compose YAML text.
 * Preserves comments, formatting, and indentation.
 * Returns the updated YAML string, or null if the fix could not be applied.
 */
export function applyFindingFix(yamlText: string, finding: Finding): string | null {
  const fixYaml = extractFixYaml(finding.fix);
  if (!fixYaml) return null;

  try {
    const doc = YAML.parseDocument(yamlText);
    const fixDoc = YAML.parseDocument(fixYaml);

    const fixServices = fixDoc.get('services') as YAMLMap | undefined;
    if (!fixServices || !YAML.isMap(fixServices) || fixServices.items.length === 0) {
      return null;
    }

    // Extract the properties to apply from the first service in the fix snippet
    const fixSvcVal = fixServices.items[0]?.value as YAMLMap | undefined;
    if (!fixSvcVal || !YAML.isMap(fixSvcVal)) {
      return null;
    }

    // Find or create the target service in doc
    const targetService = finding.service;
    let servicesMap = doc.get('services') as YAMLMap | undefined;
    if (!servicesMap || !YAML.isMap(servicesMap)) {
      doc.set('services', new YAMLMap());
      servicesMap = doc.get('services') as YAMLMap;
    }

    let svcMap = servicesMap.get(targetService) as YAMLMap | undefined;
    if (!svcMap || !YAML.isMap(svcMap)) {
      servicesMap.set(targetService, new YAMLMap());
      svcMap = servicesMap.get(targetService) as YAMLMap;
    }

    // Apply each property from the fix to the service
    for (const item of fixSvcVal.items) {
      const key = String(item.key);
      const val = item.value;

      // If applying a list (e.g. security_opt, cap_drop) and the service already has one:
      if (YAML.isSeq(val)) {
        const existing = svcMap.get(key);
        if (YAML.isSeq(existing)) {
          for (const seqItem of (val as YAMLSeq).items) {
            const rawVal = String(seqItem);
            // Don't add duplicate entries
            if (!existing.items.some((i) => String(i) === rawVal)) {
              existing.add(seqItem);
            }
          }
        } else {
          svcMap.set(key, val);
        }
      } else {
        // Scalar or map (e.g. privileged: false, read_only: true, deploy: ...)
        svcMap.set(key, val);
      }
    }

    return doc.toString();
  } catch (err) {
    console.error('Failed to apply YAML fix:', err);
    return null;
  }
}
