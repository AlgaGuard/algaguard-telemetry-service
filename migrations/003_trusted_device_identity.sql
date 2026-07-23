ALTER TABLE telemetry_samples
  ADD COLUMN IF NOT EXISTS device_uuid uuid,
  ADD COLUMN IF NOT EXISTS organization_id_at_ingest uuid,
  ADD COLUMN IF NOT EXISTS ownership_version_at_ingest numeric(20,0),
  ADD COLUMN IF NOT EXISTS timestamp_quality text,
  ADD COLUMN IF NOT EXISTS uptime_ms numeric(20,0),
  ADD COLUMN IF NOT EXISTS simulation_scenario text,
  ADD COLUMN IF NOT EXISTS extensions jsonb;

ALTER TABLE telemetry_sequence_keys
  ADD COLUMN IF NOT EXISTS device_uuid uuid,
  ADD COLUMN IF NOT EXISTS organization_id_at_ingest uuid,
  ADD COLUMN IF NOT EXISTS ownership_version_at_ingest numeric(20,0);

ALTER TABLE telemetry_batches
  ADD COLUMN IF NOT EXISTS device_uuid uuid,
  ADD COLUMN IF NOT EXISTS organization_id_at_ingest uuid,
  ADD COLUMN IF NOT EXISTS ownership_version_at_ingest numeric(20,0),
  ADD COLUMN IF NOT EXISTS first_sequence numeric(20,0),
  ADD COLUMN IF NOT EXISTS last_sequence numeric(20,0),
  ADD COLUMN IF NOT EXISTS sample_count integer;

ALTER TABLE telemetry_samples
  ADD CONSTRAINT telemetry_samples_ownership_version_positive
    CHECK (ownership_version_at_ingest IS NULL OR ownership_version_at_ingest > 0),
  ADD CONSTRAINT telemetry_samples_timestamp_quality_valid
    CHECK (timestamp_quality IS NULL OR timestamp_quality IN ('NTP_SYNCED','RTC_HOLDOVER','UNSYNCED'));

ALTER TABLE telemetry_sequence_keys
  ADD CONSTRAINT telemetry_sequence_keys_ownership_version_positive
    CHECK (ownership_version_at_ingest IS NULL OR ownership_version_at_ingest > 0);

ALTER TABLE telemetry_batches
  ADD CONSTRAINT telemetry_batches_ownership_version_positive
    CHECK (ownership_version_at_ingest IS NULL OR ownership_version_at_ingest > 0);

CREATE INDEX IF NOT EXISTS telemetry_samples_device_uuid_time
  ON telemetry_samples(device_uuid, observed_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_batches_device_uuid_time
  ON telemetry_batches(device_uuid, received_at DESC);
