-- Migration 016: Add Organization field to Users
-- Allows system users to have an organization name shown in System Keys and other views.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'Organization'
)
  ALTER TABLE Users ADD Organization NVARCHAR(150) NULL;
