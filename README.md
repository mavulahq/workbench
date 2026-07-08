# MAVULA Workbench

`@mavula/workbench` is the durable worker runtime and public platform status API
for MAVULA.

Legacy alias: `fwk`.

## Responsibilities

- BullMQ consumers with bounded retries, backoff and dead-letter queues.
- Scheduled fees, interest, reconciliation and report jobs.
- Authenticated callbacks to Ledger Core.
- Payment settlement outbox publishing.
- Dependency health, queue status and Prometheus metrics.

## Development

```bash
pnpm --filter @mavula/workbench build
pnpm --filter @mavula/workbench test:all
```

Preferred environment names are `LEDGER_CORE_URL`, `WORKBENCH_*` and
`SETTLEMENTS_*`. Legacy `FENGINE_*`, `FWK_*` and `FPAY_*` names remain supported
during the transition.

License: AGPL-3.0-only.
