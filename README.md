# algaguard-telemetry-service

TimescaleDB-backed authoritative telemetry commit, sequence idempotency, batch reconciliation, history, aggregation, and post-commit Redis publication.

```sh
npm ci
npm run migrate
npm run check
npm run test:integration
npm run dev
```

`telemetry_sequence_keys` enforces global unique `(deviceId, sequence)` independently of the Timescale time partition. `telemetry_batches` stores the durable ACK outcome. A transaction claims the batch, inserts idempotency keys and samples, and records the final outcome before returning. Redis publication occurs only after commit. Database failure cannot produce an accepted result; replay after repository restart returns `DUPLICATE` without additional rows.

Migrations are explicit and checksum guarded; startup does not create or reset tables. Redis remains non-durable live fan-out. No cloud deployment is claimed.
