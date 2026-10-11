-- Going national. Councils are now keyed by state ("vic:melton"), because names repeat across states.
-- The VicRoads flag becomes "main road" (each state's road authority), with the state alongside for per-state totals.
-- Everything stored before this was Victorian: older apps only tagged Victorian councils and VicRoads roads.
UPDATE potholes SET council = 'vic:' || council WHERE council IS NOT NULL AND instr(council, ':') = 0;
ALTER TABLE potholes RENAME COLUMN vicroads TO main_road;
ALTER TABLE potholes ADD COLUMN state TEXT;
UPDATE potholes SET state = 'vic' WHERE council IS NOT NULL OR main_road = 1;
