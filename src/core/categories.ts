import { RuleCategory } from './types';

export const CATEGORY_ORDER: RuleCategory[] = [
  'privileges',
  'isolation',
  'network',
  'secrets',
  'images',
  'reliability',
];

export const CATEGORY_LABELS: Record<RuleCategory, string> = {
  privileges: 'Privileges',
  isolation: 'Host isolation',
  network: 'Network exposure',
  secrets: 'Secrets & auth',
  images: 'Image pinning',
  reliability: 'Reliability',
};

export const CATEGORY_DESCRIPTIONS: Record<RuleCategory, string> = {
  privileges: 'Privileged mode, capabilities, no-new-privileges, and the user a container runs as.',
  isolation: 'Host namespaces, sensitive mounts, runtime sockets, devices, and confinement profiles.',
  network: 'Ports published on all interfaces and use of the legacy default bridge.',
  secrets: 'Credentials in the file and datastores without authentication.',
  images: 'Mutable tags and missing digests.',
  reliability: 'Resource limits, healthchecks, log rotation, PIDs limits, and restart policies.',
};
