-- Which council a pothole is the responsibility of (core name, e.g. "melton"), for the worst-offenders table.
-- Only set for council roads, by the phone that logged it. VicRoads roads stay NULL.
ALTER TABLE potholes ADD COLUMN council TEXT;
CREATE INDEX potholes_council ON potholes(council);
