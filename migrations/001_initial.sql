CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE telemetry_samples (device_id text NOT NULL, sequence numeric(20,0) NOT NULL, observed_at timestamptz NOT NULL, values jsonb NOT NULL, quality_flags text[] NOT NULL DEFAULT '{}', batch_id uuid NOT NULL, PRIMARY KEY(device_id, sequence, observed_at));
SELECT create_hypertable('telemetry_samples', by_range('observed_at'), if_not_exists => TRUE);
CREATE INDEX telemetry_device_time ON telemetry_samples(device_id, observed_at DESC);

