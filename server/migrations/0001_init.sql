-- Shared pothole map. Only the spot and the day it was logged are kept: no names, roads, times or IPs.
CREATE TABLE potholes (
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  day TEXT NOT NULL,          -- YYYY-MM-DD, Melbourne time
  key_hash TEXT NOT NULL      -- SHA-256 of the delete key held by the phone that logged it
);
CREATE INDEX potholes_day ON potholes(day);

-- Per-hour request counters for rate limiting, keyed by a salted IP hash. Cleared daily.
CREATE TABLE rate (
  bucket TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
