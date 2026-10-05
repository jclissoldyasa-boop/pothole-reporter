-- Riders can say a pothole is gone, "fixed" (a dodgy patch), or still there.
-- Once enough say it's gone, it comes off the map (cleared_day is set) but still counts in the totals.
ALTER TABLE potholes ADD COLUMN cleared_day TEXT;
CREATE INDEX potholes_cleared ON potholes(cleared_day);

CREATE TABLE flags (
  pothole_id TEXT NOT NULL,
  voter TEXT NOT NULL,        -- secret-salted hash of IP + pothole id: one vote each, not linkable across potholes
  kind TEXT NOT NULL CHECK (kind IN ('gone', 'fixed', 'there')),
  day TEXT NOT NULL,
  PRIMARY KEY (pothole_id, voter)
);
