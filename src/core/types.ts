/**
 * Core domain types for Composure.
 * Pure TypeScript — no React or DOM dependencies.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SourceLocation {
  /** 1-based start line number in the YAML document */
  line: number;
  /** 1-based start column number in the YAML document */
  column?: number;
  /** 1-based end line number in the YAML document */
  endLine?: number;
}

export interface LocatedString extends SourceLocation {
  value: string;
}

export interface PortMapping extends SourceLocation {
  /** Optional host IP binding, e.g. "127.0.0.1" or "::1" */
  hostIp?: string;
  /** Published host port or range, e.g. "8080" or "8080-8085" */
  published?: string;
  /** Target container port or range, e.g. "80" or "80-85" */
  target: string;
  /** Protocol, defaults to "tcp" */
  protocol: string;
  /** Port publishing mode in long syntax ("host" | "ingress") */
  mode?: string;
  /** Original raw string or representation */
  raw: string;
  /** Syntax used in the compose file */
  syntax: 'short' | 'long';
}

export interface ExposePort extends SourceLocation {
  /** Internal container port or range exposed to linked networks */
  port: string;
  /** Protocol, defaults to "tcp" */
  protocol: string;
}

export type VolumeMountType = 'volume' | 'bind' | 'tmpfs';

export interface VolumeMount extends SourceLocation {
  /** Type of mount: named/anonymous volume, host bind mount, or tmpfs */
  type: VolumeMountType;
  /** Volume name or host path (undefined for anonymous volumes or tmpfs) */
  source?: string;
  /** Path inside the container */
  target: string;
  /** Whether the mount is read-only */
  readOnly: boolean;
  /** Additional mode flags if specified (e.g. "z", "Z", "cached") */
  mode?: string;
  /** Bind mount propagation mode, e.g. "rprivate", "shared", "rshared" */
  propagation?: string;
  /** Syntax used in the compose file */
  syntax: 'short' | 'long' | 'tmpfs';
}

export interface ServiceNetwork extends SourceLocation {
  /** Network name */
  name: string;
  /** Optional network aliases for this service */
  aliases?: string[];
  /** Optional static IPv4 address */
  ipv4Address?: string;
  /** Optional static IPv6 address */
  ipv6Address?: string;
  /** True when attached automatically to the implicit "default" network */
  implicit?: boolean;
  /** Syntax used in the compose file */
  syntax: 'short' | 'long' | 'implicit';
}

export interface EnvironmentEntry extends SourceLocation {
  /** Environment variable name */
  key: string;
  /** Environment variable value, or null if passed through from host without a value */
  value: string | null;
  /** Syntax used in the compose file */
  syntax: 'map' | 'list';
}

export interface ServiceDependency extends SourceLocation {
  /** Name of the service depended upon */
  target: string;
  /** Dependency condition, e.g. "service_started", "service_healthy", "service_completed_successfully" */
  condition?: string;
  /** Whether to restart this service when dependency updates */
  restart?: boolean;
  /** Whether the dependency is required */
  required?: boolean;
  /** Syntax used in the compose file */
  syntax: 'short' | 'long';
}

export interface DeviceMapping extends SourceLocation {
  /** Host device path */
  source: string;
  /** Container device path */
  target?: string;
  /** Cgroup permissions, e.g. "rwm" */
  permissions?: string;
  /** Raw representation */
  raw: string;
}

export interface HealthcheckConfig extends SourceLocation {
  test?: string | string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  startPeriod?: string;
  disable?: boolean;
}

export interface ResourceLimits extends SourceLocation {
  /** Memory limit (from deploy.resources.limits.memory or mem_limit) */
  memory?: string;
  /** CPU limit (from deploy.resources.limits.cpus or cpus) */
  cpus?: string;
  /** Memory limit line number */
  memoryLine?: number;
  /** CPU limit line number */
  cpusLine?: number;
}

export interface LoggingConfig extends SourceLocation {
  /** Logging driver name, e.g. "json-file", "local", "syslog", "none" */
  driver?: string;
  /** Driver options, e.g. max-size, max-file */
  options?: Record<string, string>;
}

export interface BuildConfig extends SourceLocation {
  context?: string;
  dockerfile?: string;
}

/** A service-level reference to a top-level secret or config. */
export interface ServiceResourceRef extends SourceLocation {
  /** Name of the top-level secret/config */
  source: string;
  /** Mount target inside the container, if specified */
  target?: string;
}

export interface NormalizedService extends SourceLocation {
  name: string;
  image?: string;
  imageLine?: number;
  build?: BuildConfig;
  containerName?: string;
  ports: PortMapping[];
  expose: ExposePort[];
  volumes: VolumeMount[];
  networks: ServiceNetwork[];
  networkMode?: string;
  networkModeLine?: number;
  environment: EnvironmentEntry[];
  envFile: LocatedString[];
  dependsOn: ServiceDependency[];
  profiles: string[];
  profilesLine?: number;
  privileged?: boolean;
  privilegedLine?: number;
  readOnly?: boolean;
  readOnlyLine?: number;
  user?: string;
  userLine?: number;
  pid?: string;
  pidLine?: number;
  ipc?: string;
  ipcLine?: number;
  usernsMode?: string;
  usernsModeLine?: number;
  uts?: string;
  utsLine?: number;
  cgroup?: string;
  cgroupLine?: number;
  /** PIDs limit from `pids_limit` or `deploy.resources.limits.pids` */
  pidsLimit?: string;
  pidsLimitLine?: number;
  /** Replica count from `deploy.replicas` or `scale` */
  replicas?: number;
  restart?: string;
  secrets: ServiceResourceRef[];
  configs: ServiceResourceRef[];
  capAdd: LocatedString[];
  capAddLine?: number;
  capDrop: LocatedString[];
  capDropLine?: number;
  securityOpt: LocatedString[];
  securityOptLine?: number;
  devices: DeviceMapping[];
  devicesLine?: number;
  healthcheck?: HealthcheckConfig;
  resourceLimits?: ResourceLimits;
  logging?: LoggingConfig;
  loggingLine?: number;
  /** Line numbers for top-level keys defined on this service */
  fieldLines: Record<string, number>;
}

export interface NormalizedNetwork extends SourceLocation {
  name: string;
  driver?: string;
  external?: boolean;
  internal?: boolean;
  /** True when created implicitly because services have no explicit network or network_mode */
  implicit: boolean;
}

export interface NormalizedVolume extends SourceLocation {
  name: string;
  driver?: string;
  external?: boolean;
  /** True when referenced by a service but not declared in top-level volumes */
  implicit: boolean;
}

export interface NormalizedResource extends SourceLocation {
  name: string;
  /** Where the content comes from: "file", "environment", "content", or "external" */
  sourceKind?: 'file' | 'environment' | 'content' | 'external';
  /** File path, environment variable name, or inline content marker */
  sourceValue?: string;
}

export interface ComposeModel {
  /** Optional legacy version string if present */
  version?: string;
  versionLine?: number;
  /** Optional compose project name */
  name?: string;
  /** Normalized services keyed by service name */
  services: Record<string, NormalizedService>;
  /** Normalized networks keyed by network name */
  networks: Record<string, NormalizedNetwork>;
  /** Normalized named volumes keyed by volume name */
  volumes: Record<string, NormalizedVolume>;
  /** Top-level secrets keyed by name */
  secrets: Record<string, NormalizedResource>;
  /** Top-level configs keyed by name */
  configs: Record<string, NormalizedResource>;
  /** Line numbers of top-level keys */
  topLevelLines: Record<string, number>;
}

export interface ComposeParseError {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * A Compose correctness problem (as opposed to a security finding):
 * things `docker compose` would reject, or would silently do differently
 * than the author probably intended.
 */
export interface ComposeDiagnostic extends SourceLocation {
  /** Stable kebab-case identifier, e.g. "undefined-network" */
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** Service the problem belongs to, when applicable */
  service?: string;
}

export type ParseResult =
  | { ok: true; model: ComposeModel; diagnostics: ComposeDiagnostic[] }
  | { ok: false; errors: ComposeParseError[] };

export interface RuleReference {
  title: string;
  url: string;
}

/**
 * A single structured edit that an autofix performs on the Compose file.
 * Values are plain strings; the patcher takes care of YAML quoting.
 */
export type FixOperation =
  /** Set (or override) a scalar key on the service, e.g. `read_only: true` */
  | { kind: 'setScalar'; service: string; key: string; value: string | boolean | number }
  /** Remove a key from the service (only when the service defines it itself) */
  | { kind: 'removeKey'; service: string; key: string }
  /** Ensure a list key on the service contains an item */
  | { kind: 'addListItem'; service: string; key: string; item: string; compare?: ListCompareMode }
  /** Remove matching items from a list key on the service */
  | { kind: 'removeListItem'; service: string; key: string; item: string; compare?: ListCompareMode }
  /** Replace a literal environment value with another value (e.g. `${VAR}`) */
  | { kind: 'setEnvValue'; service: string; envKey: string; value: string }
  /** Bind the n-th entry of `ports` to a specific host IP */
  | { kind: 'bindPortHostIp'; service: string; index: number; hostIp: string }
  /** Set nested mapping values, e.g. logging.options.max-size */
  | { kind: 'setNested'; service: string; path: string[]; value: string };

export type ListCompareMode = 'exact' | 'capability' | 'securityOpt' | 'mountTarget';

export interface Autofix {
  /** Short, imperative description shown on the button, e.g. "Bind to 127.0.0.1" */
  label: string;
  operations: FixOperation[];
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  service: string;
  line: number;
  endLine?: number;
  description: string;
  message: string;
  fix: string;
  references: RuleReference[];
  /** Safe, structured remediation that can be applied automatically */
  autofix?: Autofix;
}

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  fix: string;
  references: RuleReference[];
  check: (model: ComposeModel) => Finding[];
}
