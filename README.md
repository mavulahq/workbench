# fwk

`fwk` is the durable worker runtime and public platform-status API for Fluxo, the Banking as a Service (BaaS) platform by getfluxo.io.

## Responsibilities

- BullMQ consumers with bounded retries, backoff, and dead-letter queues.
- Scheduled fees, interest, reconciliation, and report jobs.
- Authenticated callbacks to `fengine`, dependency health, queue status, and metrics.

## Development

Use Node.js `22.22.3`, pnpm `10.33.0`, PostgreSQL, and Redis. Run commands from the root of the `getfluxo` workspace:

```bash
pnpm install --frozen-lockfile
pnpm --filter @getfluxo/fwk build
pnpm --filter @getfluxo/fwk test:all
```

Configure `DATABASE_URL`, `REDIS_URL`, `FENGINE_URL`, and `INTERNAL_API_KEY` for integrated operation. The service defaults to port `3010` and exposes `/api/health`, `/api/status`, and `/api/metrics`.

## Repository

The canonical workspace is `git@github.com:getfluxo-io/getfluxo.git`.

Copyright (c) 2026 getfluxo.io. Proprietary software. See `LICENSE`.
