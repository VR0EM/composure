import { ComposeDiagnostic, ComposeModel, NormalizedService, PortMapping } from './types';

const VALID_PROTOCOLS = new Set(['tcp', 'udp', 'sctp']);

function hasInterpolation(value: string | undefined): boolean {
  return value !== undefined && value.includes('$');
}

/** Parse "8080" or "8080-8085" into an inclusive range; null when not numeric. */
export function parsePortRange(spec: string | undefined): [number, number] | null {
  if (spec === undefined) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  return [start, end];
}

function isAnyAddress(ip: string | undefined): boolean {
  if (ip === undefined) return true;
  const t = ip.trim();
  return t === '' || t === '0.0.0.0' || t === '::' || t === '[::]';
}

function profilesOverlap(a: NormalizedService, b: NormalizedService): boolean {
  // Services without profiles are always enabled
  if (a.profiles.length === 0 || b.profiles.length === 0) return true;
  return a.profiles.some((p) => b.profiles.includes(p));
}

function validatePort(
  service: NormalizedService,
  port: PortMapping,
  diagnostics: ComposeDiagnostic[],
) {
  const report = (message: string) =>
    diagnostics.push({
      code: 'invalid-port',
      severity: 'error',
      message,
      line: port.line,
      service: service.name,
    });

  if (!VALID_PROTOCOLS.has(port.protocol) && !hasInterpolation(port.protocol)) {
    report(`Invalid protocol \`${port.protocol}\` in port \`${port.raw}\`. Use tcp, udp, or sctp.`);
  }

  for (const [label, spec] of [
    ['container', port.target],
    ['host', port.published],
  ] as const) {
    if (spec === undefined || hasInterpolation(spec)) continue;
    const range = parsePortRange(spec);
    if (!range) {
      report(`Invalid ${label} port \`${spec}\` in \`${port.raw}\`.`);
      continue;
    }
    const [start, end] = range;
    if (start < 1 || end > 65535 || start > end) {
      report(
        `${label === 'host' ? 'Host' : 'Container'} port \`${spec}\` in \`${port.raw}\` is outside 1-65535.`,
      );
    }
  }

  const target = parsePortRange(port.target);
  const published = parsePortRange(port.published);
  if (target && published) {
    const targetSize = target[1] - target[0];
    const publishedSize = published[1] - published[0];
    // A host range may be larger than a single container port (Compose picks one),
    // but a container range must be matched by an equally sized host range.
    if (targetSize > 0 && targetSize !== publishedSize) {
      report(`Port range sizes differ in \`${port.raw}\`.`);
    }
  }
}

function findDependencyCycles(model: ComposeModel): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();

  const visit = (name: string) => {
    state.set(name, 'visiting');
    stack.push(name);
    const service = model.services[name];
    for (const dep of service?.dependsOn ?? []) {
      if (!model.services[dep.target] || dep.target === name) continue;
      const depState = state.get(dep.target);
      if (depState === 'visiting') {
        const cycle = stack.slice(stack.indexOf(dep.target));
        const key = [...cycle].sort().join('>');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (depState === undefined) {
        visit(dep.target);
      }
    }
    stack.pop();
    state.set(name, 'done');
  };

  for (const name of Object.keys(model.services)) {
    if (!state.has(name)) visit(name);
  }
  return cycles;
}

/**
 * Semantic checks on the normalized model: references, conflicts, and
 * combinations that `docker compose` rejects or silently ignores.
 */
export function validateComposeModel(model: ComposeModel): ComposeDiagnostic[] {
  const diagnostics: ComposeDiagnostic[] = [];
  const services = Object.values(model.services);

  if (model.version !== undefined) {
    diagnostics.push({
      code: 'obsolete-version',
      severity: 'info',
      message:
        'The top-level `version` key is obsolete and ignored by Docker Compose v2. You can remove it.',
      line: model.versionLine ?? 1,
    });
  }

  if (model.topLevelLines['include'] !== undefined) {
    diagnostics.push({
      code: 'unresolved-include',
      severity: 'info',
      message:
        'Files pulled in with `include` are not analyzed. Open them separately to check them too.',
      line: model.topLevelLines['include'],
    });
  }

  const containerNames = new Map<string, NormalizedService>();

  for (const service of services) {
    const at = (line: number | undefined) => ({
      line: line ?? service.line,
      service: service.name,
    });

    // Image or build
    const hasExtends = service.fieldLines['extends'] !== undefined;
    const hasProvider = service.fieldLines['provider'] !== undefined;
    if (!service.image && !service.build && !hasExtends && !hasProvider) {
      diagnostics.push({
        code: 'missing-image',
        severity: 'error',
        message: `Service \`${service.name}\` has neither \`image\` nor \`build\`. Compose cannot create it.`,
        ...at(service.line),
      });
    }

    if (hasExtends) {
      diagnostics.push({
        code: 'unresolved-extends',
        severity: 'info',
        message: `\`extends\` is not resolved, so settings inherited by \`${service.name}\` are not analyzed.`,
        ...at(service.fieldLines['extends']),
      });
    }

    // depends_on
    for (const dep of service.dependsOn) {
      const target = model.services[dep.target];
      if (dep.target === service.name) {
        diagnostics.push({
          code: 'self-dependency',
          severity: 'error',
          message: `Service \`${service.name}\` depends on itself.`,
          ...at(dep.line),
        });
        continue;
      }
      if (!target) {
        diagnostics.push({
          code: 'undefined-service',
          severity: 'error',
          message: `\`depends_on\` refers to undefined service \`${dep.target}\`.`,
          ...at(dep.line),
        });
        continue;
      }

      if (dep.required !== false && target.profiles.length > 0) {
        const shared = service.profiles.some((p) => target.profiles.includes(p));
        if (!shared) {
          const profileList = target.profiles.map((p) => `\`${p}\``).join(', ');
          diagnostics.push({
            code: 'profile-dependency',
            severity: 'warning',
            message: `\`${dep.target}\` only runs with profile ${profileList}, so starting \`${service.name}\` without it fails with "depends on undefined service". Share the profile, or set \`required: false\` on the dependency.`,
            ...at(dep.line),
          });
        }
      }

      if (dep.condition === 'service_healthy') {
        const hc = target.healthcheck;
        const disabled =
          !hc ||
          hc.disable === true ||
          (Array.isArray(hc.test) ? hc.test[0]?.toUpperCase() === 'NONE' : hc.test?.toUpperCase() === 'NONE');
        if (disabled) {
          diagnostics.push({
            code: 'healthcheck-dependency',
            severity: 'warning',
            message: `Waits for \`${dep.target}\` to be healthy, but \`${dep.target}\` defines no healthcheck. Unless its image has a HEALTHCHECK, \`docker compose up\` fails.`,
            ...at(dep.line),
          });
        }
      }
    }

    // network_mode
    const networkMode = service.networkMode?.trim();
    const explicitNetworks = service.networks.filter((n) => !n.implicit);
    if (networkMode && explicitNetworks.length > 0) {
      diagnostics.push({
        code: 'network-mode-conflict',
        severity: 'error',
        message: '`network_mode` and `networks` cannot be combined on the same service.',
        ...at(service.networkModeLine),
      });
    }
    if (networkMode?.startsWith('service:')) {
      const ref = networkMode.slice('service:'.length);
      if (!model.services[ref] && !hasInterpolation(ref)) {
        diagnostics.push({
          code: 'undefined-service',
          severity: 'error',
          message: `\`network_mode\` refers to undefined service \`${ref}\`.`,
          ...at(service.networkModeLine),
        });
      }
    }
    if (networkMode === 'host' && service.ports.length > 0) {
      diagnostics.push({
        code: 'ports-ignored',
        severity: 'warning',
        message:
          'Published `ports` are ignored with `network_mode: host`; the container binds directly to host ports.',
        ...at(service.fieldLines['ports']),
      });
    }

    // Networks referenced but not declared
    for (const net of explicitNetworks) {
      const declared = model.networks[net.name];
      if (net.name !== 'default' && (!declared || declared.implicit) && !hasInterpolation(net.name)) {
        diagnostics.push({
          code: 'undefined-network',
          severity: 'error',
          message: `Refers to undefined network \`${net.name}\`. Declare it under the top-level \`networks\` key.`,
          ...at(net.line),
        });
      }
    }

    // Named volumes referenced but not declared
    for (const mount of service.volumes) {
      if (mount.type !== 'volume' || !mount.source || hasInterpolation(mount.source)) continue;
      const declared = model.volumes[mount.source];
      if (!declared || declared.implicit) {
        diagnostics.push({
          code: 'undefined-volume',
          severity: 'error',
          message: `Refers to undefined volume \`${mount.source}\`. Declare it under the top-level \`volumes\` key, or use \`./${mount.source}\` for a bind mount.`,
          ...at(mount.line),
        });
      }
    }

    // Secrets and configs
    for (const [kind, refs, declared] of [
      ['secret', service.secrets, model.secrets],
      ['config', service.configs, model.configs],
    ] as const) {
      for (const ref of refs) {
        if (!declared[ref.source] && !hasInterpolation(ref.source)) {
          diagnostics.push({
            code: `undefined-${kind}`,
            severity: 'error',
            message: `Refers to undefined ${kind} \`${ref.source}\`. Declare it under the top-level \`${kind}s\` key.`,
            ...at(ref.line),
          });
        }
      }
    }

    // Ports
    for (const port of service.ports) validatePort(service, port, diagnostics);

    // container_name
    if (service.containerName) {
      const other = containerNames.get(service.containerName);
      if (other) {
        diagnostics.push({
          code: 'duplicate-container-name',
          severity: 'error',
          message: `Container name \`${service.containerName}\` is also used by \`${other.name}\`.`,
          ...at(service.fieldLines['container_name']),
        });
      } else {
        containerNames.set(service.containerName, service);
      }
      if ((service.replicas ?? 1) > 1) {
        diagnostics.push({
          code: 'container-name-replicas',
          severity: 'error',
          message: `A fixed \`container_name\` cannot be used with ${service.replicas} replicas.`,
          ...at(service.fieldLines['container_name']),
        });
      }
    }

    if (service.fieldLines['links'] !== undefined) {
      diagnostics.push({
        code: 'legacy-links',
        severity: 'info',
        message:
          '`links` is a legacy option. Services on a shared network already reach each other by service name.',
        ...at(service.fieldLines['links']),
      });
    }
  }

  // Dependency cycles
  for (const cycle of findDependencyCycles(model)) {
    const first = model.services[cycle[0]!];
    const dep = first?.dependsOn.find((d) => d.target === cycle[1 % cycle.length]);
    diagnostics.push({
      code: 'dependency-cycle',
      severity: 'error',
      message: `Circular \`depends_on\`: ${[...cycle, cycle[0]].join(' → ')}.`,
      line: dep?.line ?? first?.line ?? 1,
      ...(first ? { service: first.name } : {}),
    });
  }

  // Host port conflicts across services
  interface Binding {
    service: NormalizedService;
    port: PortMapping;
    range: [number, number];
  }
  const bindings: Binding[] = [];
  for (const service of services) {
    if (service.networkMode?.trim() === 'host') continue;
    for (const port of service.ports) {
      if (hasInterpolation(port.published) || hasInterpolation(port.hostIp)) continue;
      const range = parsePortRange(port.published);
      if (!range) continue;
      bindings.push({ service, port, range });
    }
  }
  const reported = new Set<string>();
  for (let i = 0; i < bindings.length; i++) {
    for (let j = i + 1; j < bindings.length; j++) {
      const a = bindings[i]!;
      const b = bindings[j]!;
      if (a.port.protocol !== b.port.protocol) continue;
      if (a.range[1] < b.range[0] || b.range[1] < a.range[0]) continue;
      // A host range lets Compose pick a free port, so only single ports can clash
      if (a.range[0] !== a.range[1] || b.range[0] !== b.range[1]) continue;
      const ipA = a.port.hostIp?.replace(/^\[|\]$/g, '');
      const ipB = b.port.hostIp?.replace(/^\[|\]$/g, '');
      const ipOverlap = isAnyAddress(ipA) || isAnyAddress(ipB) || ipA === ipB;
      if (!ipOverlap || !profilesOverlap(a.service, b.service)) continue;
      const key = `${b.service.name}:${b.port.line}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const where =
        a.service.name === b.service.name ? 'earlier in this service' : `by \`${a.service.name}\``;
      diagnostics.push({
        code: 'port-conflict',
        severity: 'error',
        message: `Host port ${b.port.published}/${b.port.protocol} is already published ${where} (line ${a.port.line}). The second container fails with "port is already allocated".`,
        line: b.port.line,
        service: b.service.name,
      });
    }
  }

  return diagnostics.sort((a, b) => a.line - b.line);
}
