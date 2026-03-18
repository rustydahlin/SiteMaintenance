-- 012_repair_sentdate_nullable.sql
-- Makes SentDate nullable so RMAs can be created before the item is physically shipped.
-- The Sent Date is now filled in manually on the day of shipment; until then the RMA
-- is considered "Not Sent" and the assigned user receives periodic email reminders.

ALTER TABLE RepairTracking ALTER COLUMN SentDate DATE NULL;
