import { DEFAULT_COMPOSE_YAML } from './defaultCompose';

export interface ComposeExample {
  id: string;
  label: string;
  badge: string;
  description: string;
  yaml: string;
}

export const INSECURE_COMPOSE_YAML = `name: vulnerable-homelab-stack

services:
  portainer-agent:
    image: portainer/agent:latest
    privileged: true
    pid: host
    ports:
      - "9001:9001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/volumes:/var/lib/docker/volumes:rw

  legacy-webapp:
    image: node
    user: "root"
    network_mode: host
    cap_add:
      - SYS_ADMIN
      - NET_ADMIN
    security_opt:
      - seccomp:unconfined
    devices:
      - "/dev/ttyUSB0:/dev/ttyUSB0:rwm"
    volumes:
      - /etc:/host-etc:rw
    environment:
      NODE_ENV: production
      JWT_SECRET: "super-secret-jwt-signing-key-do-not-share"
      STRIPE_API_KEY: "sk_live_51H89abc1234567890"
    depends_on:
      - exposed-postgres
      - exposed-redis

  exposed-postgres:
    image: postgres:latest
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=PlaintextPassword123!
    volumes:
      - db_data:/var/lib/postgresql/data

  exposed-redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  db_data:
`;

export const HARDENED_COMPOSE_YAML = `name: hardened-zero-trust-stack

x-hardened: &hardened-defaults
  privileged: false
  read_only: true
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
  deploy:
    resources:
      limits:
        memory: 256M
        cpus: "0.50"

services:
  ingress:
    <<: *hardened-defaults
    image: nginx:1.27.3-alpine@sha256:4ff102c5d78d254a6f0da062b3cf39eaf07f01eec0927fd21e219d0af8bc0591
    user: "101:101"
    ports:
      - "127.0.0.1:8443:8443"
    cap_add:
      - NET_BIND_SERVICE
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    tmpfs:
      - /var/cache/nginx:ro,noexec,nosuid,size=32m
      - /var/run:rw,noexec,nosuid,size=8m
    networks:
      - edge_net
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "https://localhost:8443/healthz"]
      interval: 15s
      timeout: 3s
      retries: 3

  api:
    <<: *hardened-defaults
    image: node:22.13.1-alpine@sha256:e5dde631c0d1ff9c907f03f827c9a68b2d0d4d6321899622706f1d452c871290
    user: "1000:1000"
    expose:
      - "3000"
    environment:
      NODE_ENV: production
      DATABASE_PASSWORD: \${DATABASE_PASSWORD}
      JWT_SECRET_FILE: /run/secrets/jwt_secret
    tmpfs:
      - /tmp
    networks:
      - edge_net
      - db_internal
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/ready"]
      interval: 15s
      timeout: 3s
      retries: 3

  postgres:
    <<: *hardened-defaults
    image: postgres:16.6-alpine@sha256:fb2bd9bf8c14fb06d4f490802e635a68e2e202c3d8a9f54463460336381a953b
    user: "70:70"
    expose:
      - "5432"
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${DATABASE_PASSWORD}
    volumes:
      - pg_encrypted_data:/var/lib/postgresql/data
    tmpfs:
      - /run/postgresql
      - /tmp
    networks:
      - db_internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 10s
      timeout: 3s
      retries: 5

networks:
  edge_net:
    driver: bridge
  db_internal:
    driver: bridge
    internal: true

volumes:
  pg_encrypted_data:
    driver: local
`;

export const MICROSERVICES_COMPOSE_YAML = `name: microservices-observability

x-service-base: &service-base
  user: "1000:1000"
  read_only: true
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
  deploy:
    resources:
      limits:
        memory: 384M
        cpus: "0.50"

services:
  gateway:
    <<: *service-base
    image: traefik:v3.2
    ports:
      - "127.0.0.1:8080:80"
    networks:
      - public_mesh
      - service_mesh
    depends_on:
      - orders-svc
      - payments-svc
    healthcheck:
      test: ["CMD", "traefik", "healthcheck"]
      interval: 15s
      timeout: 3s
      retries: 3

  orders-svc:
    <<: *service-base
    image: ghcr.io/acme/orders:\${ORDERS_TAG:-2.4.0}
    expose:
      - "4000"
    environment:
      DB_PASSWORD: \${ORDERS_DB_PASS}
      QUEUE_URL: amqp://mq:5672
    networks:
      - service_mesh
    depends_on:
      - mq
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 20s
      timeout: 3s
      retries: 3

  payments-svc:
    <<: *service-base
    image: ghcr.io/acme/payments:\${PAYMENTS_TAG:-1.9.1}
    expose:
      - "4001"
    environment:
      STRIPE_SECRET_KEY: \${STRIPE_SECRET_KEY}
    networks:
      - service_mesh
    depends_on:
      - mq
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4001/health"]
      interval: 20s
      timeout: 3s
      retries: 3

  mq:
    <<: *service-base
    image: rabbitmq:3.13-alpine
    expose:
      - "5672"
    volumes:
      - mq_state:/var/lib/rabbitmq
    networks:
      - service_mesh
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 20s
      timeout: 5s
      retries: 3

  jaeger:
    <<: *service-base
    image: jaegertracing/all-in-one:1.62
    profiles:
      - observability
      - debug
    ports:
      - "127.0.0.1:16686:16686"
    networks:
      - service_mesh
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:14269/"]
      interval: 20s
      timeout: 3s
      retries: 3

networks:
  public_mesh:
  service_mesh:
    internal: true

volumes:
  mq_state:
`;

export const COMPOSE_EXAMPLES: ComposeExample[] = [
  {
    id: 'production-stack',
    label: 'Web Stack (Default)',
    badge: 'Balanced',
    description: 'Nginx reverse proxy, Node API, PostgreSQL, and Redis cache',
    yaml: DEFAULT_COMPOSE_YAML,
  },
  {
    id: 'deliberately-insecure',
    label: 'Insecure Stack (Demo)',
    badge: 'Grade F',
    description: 'Deliberately vulnerable compose file demonstrating critical hardening findings',
    yaml: INSECURE_COMPOSE_YAML,
  },
  {
    id: 'hardened-reference',
    label: 'Hardened Zero-Trust',
    badge: 'Grade A',
    description: 'Digest-pinned, non-root, read-only rootfs, cap_drop: ALL, and internal networks',
    yaml: HARDENED_COMPOSE_YAML,
  },
  {
    id: 'microservices-anchors',
    label: 'Microservices & Anchors',
    badge: 'YAML <<',
    description: 'Multi-service architecture using YAML anchors, merge keys, and profiles',
    yaml: MICROSERVICES_COMPOSE_YAML,
  },
];
