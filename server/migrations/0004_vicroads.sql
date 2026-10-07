-- Worst offenders now count every pothole in a council's area, whoever looks after the road.
-- This flag marks the ones on VicRoads roads, for the separate VicRoads total. Set by the phone that logged it.
ALTER TABLE potholes ADD COLUMN vicroads INTEGER NOT NULL DEFAULT 0;
