CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  delivery_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  raw_body_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'Received'
    CHECK (status IN ('Received', 'Completed', 'Failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processing BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS events_created_at_idx ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS events_status_idx ON events (status);

