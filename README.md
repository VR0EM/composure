# Composure

**Composure** is an open-source, 100% client-side web application that visualizes any `docker-compose.yml` as an interactive architecture diagram and runs a comprehensive security hardening check against it.

Paste or drop a Compose file to immediately inspect:
1. **Interactive Topology Diagram**: Services, networks (including implicit `default`), named volumes, host bind mounts (`ro`/`rw`), published host ports (`Host / Internet` vs loopback entry points), and `depends_on` startup relationships.
2. **Security Hardening Scout**: An overall hardening score and letter grade (`A` to `F`), severity-grouped findings mapped to exact YAML line numbers, explanations, and copy-pasteable YAML fixes referenced against the CIS Docker Benchmark and official Docker documentation.

---

## Privacy Statement: 100% Client-Side

- **Zero Backend**: Composure runs entirely inside your browser.
- **No External API Calls**: Your `docker-compose.yml` is parsed, laid out, and analyzed locally in JavaScript/TypeScript.
- **No Analytics or Telemetry**: No tracking scripts, cookies, or telemetry pings are included.
- **Serverless Sharing**: When you click **Share**, your YAML is compressed locally using the browser's `CompressionStream` (`deflate-raw`) and placed in the URL `#compose=...` fragment, which is never sent to a server.

---

## Screenshots

> _Screenshot placeholders: replace with captures from your deployment:_

| Interactive Topology & Live YAML Editor (Dark Mode) | Security Hardening Findings & Node Inspector (Light Mode) |
| :---: | :---: |
| `docs/screenshots/composure-dark-placeholder.png` | `docs/screenshots/composure-light-placeholder.png` |

---

## Key Features

- **Full Compose Syntax Normalization**:
  - Short and long syntax for `ports`, `volumes`, `networks`, `environment`, and `depends_on`
  - YAML anchors (`&`), aliases (`*`), and single/multi merge keys (`<<`)
  - Preserves `${VAR:-default}` variable interpolations verbatim without breaking port or volume parsing
  - Handles `network_mode` (`host`, `none`, `service:<name>`, `container:<name>`), `expose` vs `ports`, `tmpfs`, `profiles`, and `x-` extension fields
- **Live Synchronized Editor & Diagram**:
  - CodeMirror 6 editor with YAML syntax highlighting, severity gutter markers, and click-to-jump line highlighting
  - Automatic layered graph layout powered by `elkjs` and `@xyflow/react`
  - Retains the last valid diagram while you are mid-edit with invalid YAML
- **Export & Sharing**:
  - Export topology diagram as vector **SVG** or high-DPI **PNG**
  - Export security hardening report as **Markdown** (`.md`)
  - Share configurations via compressed URL hash (`#compose=...`)

---

## Hardening Rules (`CMP001` to `CMP016`)

| Rule ID | Severity | Title | What It Checks |
| :--- | :--- | :--- | :--- |
| **`CMP001`** | `critical` | Privileged mode enabled | Flags `privileged: true` on a service. |
| **`CMP002`** | `critical` | Docker socket mounted | Flags `/var/run/docker.sock` or `/run/docker.sock` mounts, including when mounted `:ro` (read-only does not block Docker API calls). |
| **`CMP003`** | `medium` / `info` | Unpinned image tag | Flags `:latest` or omitted tags as `medium`, and emits an `info` note when an image tag is not pinned by `@sha256:` digest. |
| **`CMP004`** | `high` / `medium` | Port bound to 0.0.0.0 | Flags ports published without a loopback/specific host IP (`0.0.0.0`). Escalates to `high` for database/cache ports (`5432`, `3306`, `27017`, `6379`, `9200`, `11211`). |
| **`CMP005`** | `high` | Host namespace shared | Flags `network_mode: host`, `pid: host`, `ipc: host`, and `userns_mode: host`. |
| **`CMP006`** | `critical` / `high` | Risky capability added | Flags `ALL` (`critical`) and `SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE`, `SYS_MODULE`, `DAC_READ_SEARCH` (`high`). |
| **`CMP007`** | `low` | Capabilities not dropped | Flags services that do not specify `cap_drop: [ALL]`. |
| **`CMP008`** | `high` | Unconfined security opt | Flags `seccomp:unconfined` or `apparmor:unconfined` in `security_opt`. |
| **`CMP009`** | `medium` | No no-new-privileges | Flags services without `no-new-privileges:true` in `security_opt`. |
| **`CMP010`** | `critical` / `high` | Sensitive host path mount | Flags bind mounts of `/`, `/etc`, `/root`, `/home`, `/proc`, `/sys`, `/var/lib/docker` (`critical` when `rw`, `high` when `ro`). |
| **`CMP011`** | `medium` | Host device exposed | Flags host hardware device pass-throughs under `devices`. |
| **`CMP012`** | `high` | Secret in environment | Flags literal values for keys matching `PASSWORD`, `SECRET`, `TOKEN`, `API_KEY`, etc. in map or list syntax instead of `${VAR}`, `env_file`, or Docker secrets. |
| **`CMP013`** | `medium` / `info` | No non-root user set | Emits `info` when `user` is omitted (image default may be root) and `medium` when `user` is explicitly set to `root` or `0`. |
| **`CMP014`** | `low` | No resource limits set | Flags services missing memory or CPU limits in `deploy.resources.limits` or `mem_limit`/`cpus`. |
| **`CMP015`** | `low` | No healthcheck defined | Flags services without an active `healthcheck`. |
| **`CMP016`** | `info` | Root filesystem writable | Flags services without `read_only: true`. |

---

## Architecture

Composure is strictly separated into a pure TypeScript core engine and a React UI layer so the core engine can be reused in a standalone CLI or GitHub Action:

- `src/core/`: Pure TypeScript (zero React or DOM imports). Contains the YAML parser (`parser.ts`), Compose syntax normalizer (`normalizer.ts`), graph builder (`graph.ts`), rule engine (`ruleEngine.ts`), Markdown report generator (`report.ts`), and URL hash compressor (`share.ts`).
- `src/core/rules/`: One file per hardening rule (`CMP001` through `CMP016`).
- `src/ui/`: React components, CodeMirror 6 editor integration, and React Flow + ELK diagram components.
- `tests/`: Vitest test suites and YAML fixtures (`tests/fixtures/`).

---

## Running Locally

### Prerequisites
- Node.js 20+ and npm

### Setup & Commands

```bash
# 1. Install dependencies
npm install

# 2. Start the local development server
npm run dev

# 3. Run the unit test suite (Vitest)
npm test

# 4. Type-check and build the production bundle
npm run build
```

---

## Contributing & License

Contributions and new hardening rules are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for instructions on adding a new rule and writing test fixtures.

Released under the [MIT License](./LICENSE).
