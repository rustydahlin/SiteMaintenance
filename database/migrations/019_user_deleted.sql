-- Migration 019: Add DeletedAt to Users for soft-delete with name preservation

ALTER TABLE Users
  ADD DeletedAt DATETIME2(0) NULL;
GO

CREATE INDEX IX_Users_DeletedAt ON Users(DeletedAt) WHERE DeletedAt IS NOT NULL;
GO
