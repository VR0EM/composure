export const DEFAULT_COMPOSE_YAML = `name: composure-demo

x-common-env: &common-env
  TZ: \${TZ:-UTC}
  LOG_LEVEL: info

services:
  proxy:
    image: nginx:1.27-alpine
    ports:
      - "8080:80"
      - "127.0.0.1:8443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - frontend
    depends_on:
      api:
        condition: service_healthy
    read_only: true
    tmpfs:
      - /var/cache/nginx
      - /var/run

  api:
    image: node:22-alpine
    expose:
      - "3000"
    environment:
      <<: *common-env
      DATABASE_URL: postgres://app:\${DB_PASSWORD}@db:5432/app
      REDIS_URL: redis://cache:6379
    networks:
      - frontend
      - backend
    depends_on:
      - db
      - cache
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 15s
      timeout: 3s
      retries: 3

  db:
    image: postgres:16-alpine
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks:
      - backend

  cache:
    image: redis:7.4-alpine
    profiles:
      - cache
    volumes:
      - redis_data:/data
    networks:
      - backend

networks:
  frontend:
  backend:
    internal: true

volumes:
  pg_data:
  redis_data:
`;
