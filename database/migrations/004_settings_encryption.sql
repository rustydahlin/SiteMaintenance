-- Migration 004: Add IsEncrypted column to AppSettings
-- Safe to run on existing databases — skips if column already exists.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('AppSettings') AND name = 'IsEncrypted'
)
BEGIN
    ALTER TABLE AppSettings
    ADD IsEncrypted BIT NOT NULL DEFAULT 0;

    PRINT 'Added IsEncrypted column to AppSettings.';
END
ELSE
BEGIN
    PRINT 'IsEncrypted column already exists — skipping.';
END
