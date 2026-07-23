# algaguard-telemetry-service

TimescaleDB-backed authoritative telemetry commit, sequence idempotency, batch reconciliation, UUID-addressed history and aggregation, and post-commit Redis publication.

```sh
npm ci
npm run migrate
npm run check
npm run test:integration
npm run dev
```

`telemetry_sequence_keys` enforces global unique `(deviceId, sequence)` independently of the Timescale time partition. `telemetry_batches` stores the durable ACK outcome. A transaction claims the batch, inserts idempotency keys and samples with `deviceUuid`, `organizationIdAtIngest`, and `ownershipVersionAtIngest`, and records the final outcome before returning. Legacy rows remain valid with nullable added identity columns. Redis `telemetry.committed` publication occurs only after commit. Database failure cannot produce an accepted result; replay after repository restart returns `DUPLICATE` without additional rows.

The ingestion endpoint validates a Keycloak bearer token and accepts only the `algaguard-mqtt-ingestion-service` client. Before persistence, Telemetry independently re-resolves Device Service context and rejects stale ownership with `STALE_DEVICE_CONTEXT`. HTTPS telemetry reads use `deviceUuid`, validate the user token, and obtain a machine-to-machine Access Service decision with trusted current-organization context. History and aggregates are filtered by `organizationIdAtIngest`; a new owner cannot read pre-transfer rows through the normal API. The service never trusts subject, organization, or role headers, and historical rows remain intact for explicit audit-policy handling.

Migrations are explicit and checksum guarded; startup does not create or reset tables. Redis remains non-durable live fan-out. No cloud deployment is claimed.
