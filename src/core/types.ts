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

export interface ComposeModel {
  /** Optional legacy version string if present */
  version?: string;
  /** Optional compose project name */
  name?: string;
  /** Normalized services keyed by service name */
  services: Record<string, NormalizedService>;
  /** Normalized networks keyed by network name */
  networks: Record<string, NormalizedNetwork>;
  /** Normalized named volumes keyed by volume name */
  volumes: Record<string, NormalizedVolume>;
}

export interface ComposeParseError {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
}

export type ParseResult =
  | { ok: true; model: ComposeModel; warnings: ComposeParseError[] }
  | { ok: false; errors: ComposeParseError[] };

export interface RuleReference {
  title: string;
  url: string;
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
