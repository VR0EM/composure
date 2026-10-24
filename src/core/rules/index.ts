import { Rule } from '../types';
import { CMP001 } from './CMP001-privileged';
import { CMP002 } from './CMP002-docker-socket';
import { CMP003 } from './CMP003-image-tag';
import { CMP004 } from './CMP004-published-ports';
import { CMP005 } from './CMP005-host-namespaces';
import { CMP006 } from './CMP006-cap-add';
import { CMP007 } from './CMP007-cap-drop';
import { CMP008 } from './CMP008-security-opt-unconfined';
import { CMP009 } from './CMP009-no-new-privileges';
import { CMP010 } from './CMP010-sensitive-host-paths';
import { CMP011 } from './CMP011-devices';
import { CMP012 } from './CMP012-environment-secrets';
import { CMP013 } from './CMP013-no-user';
import { CMP014 } from './CMP014-resource-limits';
import { CMP015 } from './CMP015-no-healthcheck';
import { CMP016 } from './CMP016-read-only-rootfs';
import { CMP017 } from './CMP017-logging-max-size';
import { CMP018 } from './CMP018-default-bridge-network';

export {
  CMP001,
  CMP002,
  CMP003,
  CMP004,
  CMP005,
  CMP006,
  CMP007,
  CMP008,
  CMP009,
  CMP010,
  CMP011,
  CMP012,
  CMP013,
  CMP014,
  CMP015,
  CMP016,
  CMP017,
  CMP018,
};

export const ALL_RULES: Rule[] = [
  CMP001,
  CMP002,
  CMP003,
  CMP004,
  CMP005,
  CMP006,
  CMP007,
  CMP008,
  CMP009,
  CMP010,
  CMP011,
  CMP012,
  CMP013,
  CMP014,
  CMP015,
  CMP016,
  CMP017,
  CMP018,
];
