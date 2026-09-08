# Deployment

Initial production (modular monolith, not microservices):

- web (this TanStack app)
- postgres
- redis (later, for jobs)
- worker/scheduler (later)
- network agent (on ISP network)
- FreeRADIUS (own container)
- GenieACS (own container)
- reverse proxy / TLS

`DATABASE_URL` → Neon/Postgres. Unset → PGLite preview only.

Migrate: `npm run db:migrate` (versioned files in `/migrations`).

Health: `GET /api/v1/health`.

Do not put MikroTik, FreeRADIUS, or GenieACS inside the web container.

Django `artifacts/isp-saas` compose files are **not** the production path.
