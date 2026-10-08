-- Which way the rider was travelling when they logged it (degrees, rounded to 10), so pothole-ahead warnings
-- only go to riders heading the same way, not to traffic on the other side of the road. NULL if unknown.
ALTER TABLE potholes ADD COLUMN heading INTEGER;
