/**
 * Known keys from the Compose Specification, used to flag typos such as
 * `enviroment:` or `port:`. Docker Compose rejects unknown keys, so catching
 * them early saves a confusing `additional properties not allowed` error.
 *
 * Lists follow https://docs.docker.com/reference/compose-file/ and include a
 * few legacy keys Compose still accepts, to avoid false warnings.
 */

export const TOP_LEVEL_KEYS = [
  'version',
  'name',
  'include',
  'services',
  'networks',
  'volumes',
  'secrets',
  'configs',
  'models',
] as const;

export const SERVICE_KEYS = [
  'annotations',
  'attach',
  'blkio_config',
  'build',
  'cap_add',
  'cap_drop',
  'cgroup',
  'cgroup_parent',
  'command',
  'configs',
  'container_name',
  'cpu_count',
  'cpu_percent',
  'cpu_period',
  'cpu_quota',
  'cpu_rt_period',
  'cpu_rt_runtime',
  'cpu_shares',
  'cpus',
  'cpuset',
  'credential_spec',
  'depends_on',
  'deploy',
  'develop',
  'device_cgroup_rules',
  'devices',
  'dns',
  'dns_opt',
  'dns_search',
  'domainname',
  'entrypoint',
  'env_file',
  'environment',
  'expose',
  'extends',
  'external_links',
  'extra_hosts',
  'gpus',
  'group_add',
  'healthcheck',
  'hostname',
  'image',
  'init',
  'ipc',
  'isolation',
  'label_file',
  'labels',
  'links',
  'logging',
  'mac_address',
  'mem_limit',
  'mem_reservation',
  'mem_swappiness',
  'memswap_limit',
  'models',
  'network_mode',
  'networks',
  'oom_kill_disable',
  'oom_score_adj',
  'pid',
  'pids_limit',
  'platform',
  'ports',
  'post_start',
  'pre_stop',
  'privileged',
  'profiles',
  'provider',
  'pull_policy',
  'read_only',
  'restart',
  'runtime',
  'scale',
  'secrets',
  'security_opt',
  'shm_size',
  'stdin_open',
  'stop_grace_period',
  'stop_signal',
  'storage_opt',
  'sysctls',
  'tmpfs',
  'tty',
  'ulimits',
  'use_api_socket',
  'user',
  'userns_mode',
  'uts',
  'volume_driver',
  'volumes',
  'volumes_from',
  'working_dir',
] as const;

export const HEALTHCHECK_KEYS = [
  'test',
  'interval',
  'timeout',
  'retries',
  'start_period',
  'start_interval',
  'disable',
] as const;

export const LOGGING_KEYS = ['driver', 'options'] as const;

export const DEPLOY_KEYS = [
  'endpoint_mode',
  'labels',
  'mode',
  'placement',
  'replicas',
  'resources',
  'restart_policy',
  'rollback_config',
  'update_config',
] as const;

export const BUILD_KEYS = [
  'additional_contexts',
  'args',
  'cache_from',
  'cache_to',
  'context',
  'dockerfile',
  'dockerfile_inline',
  'entitlements',
  'extra_hosts',
  'isolation',
  'labels',
  'network',
  'no_cache',
  'platforms',
  'privileged',
  'provenance',
  'pull',
  'sbom',
  'secrets',
  'shm_size',
  'ssh',
  'tags',
  'target',
  'ulimits',
] as const;

export const DEPENDS_ON_KEYS = ['condition', 'restart', 'required'] as const;

export const DEPENDS_ON_CONDITIONS = [
  'service_started',
  'service_healthy',
  'service_completed_successfully',
] as const;

export const NETWORK_KEYS = [
  'attachable',
  'driver',
  'driver_opts',
  'enable_ipv4',
  'enable_ipv6',
  'external',
  'internal',
  'ipam',
  'labels',
  'name',
] as const;

export const VOLUME_KEYS = ['driver', 'driver_opts', 'external', 'labels', 'name'] as const;

/**
 * Edit distance where swapping two adjacent letters counts as one edit
 * (optimal string alignment), so `tset` is one typo away from `test`.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Suggest the closest known key for a probable typo, or null when nothing
 * is close enough to be a confident suggestion.
 */
export function suggestKey(unknown: string, known: readonly string[]): string | null {
  const needle = unknown.toLowerCase().replace(/-/g, '_');
  // Exact match after normalizing case and dashes (e.g. `Container-Name`)
  const normalizedHit = known.find((k) => k === needle);
  if (normalizedHit) return normalizedHit;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of known) {
    const d = editDistance(needle, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  const threshold = needle.length <= 4 ? 1 : needle.length <= 8 ? 2 : 3;
  if (best && bestDistance <= threshold) return best;

  // Singular/plural slips such as `port` -> `ports`, `volume` -> `volumes`
  const plural = known.find((k) => k === `${needle}s` || `${k}s` === needle);
  return plural ?? null;
}
