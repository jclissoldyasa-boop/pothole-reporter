-- Feedback riders send from the app. Only what they type (plus their phone type, to help track down bugs)
-- and the day. No IP address or time. Read on the private /inbox page.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT,
  device TEXT
);
