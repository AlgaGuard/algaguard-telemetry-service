CREATE TABLE IF NOT EXISTS telemetry_sequence_keys (
  device_id text NOT NULL,
  sequence numeric(20,0) NOT NULL,
  batch_id uuid NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id, sequence)
);

CREATE TABLE IF NOT EXISTS telemetry_batches (
  batch_id uuid PRIMARY KEY,
  device_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('PROCESSING','ACCEPTED','PARTIALLY_ACCEPTED','REJECTED','DUPLICATE')),
  accepted_through_sequence numeric(20,0),
  duplicate boolean NOT NULL,
  stored_samples integer NOT NULL,
  rejected_sequences text[] NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS telemetry_batches_device_time ON telemetry_batches(device_id,received_at DESC);
