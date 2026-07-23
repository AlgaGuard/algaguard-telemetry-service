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

The ingestion endpoint validates a Keycloak bearer token and accepts only the `algaguard-mqtt-ingestion-service` client. HTTPS telemetry reads validate the user token and obtain a machine-to-machine Access Service decision for the requested device. The service never trusts subject, organization, or role headers. Batch validation matches the contract maximum of 120 samples, and partial outcomes use contract-valid error details.

Migrations are explicit and checksum guarded; startup does not create or reset tables. Redis remains non-durable live fan-out. No cloud deployment is claimed.
