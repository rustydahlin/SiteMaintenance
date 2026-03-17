-- Migration 005: Add ParentSiteID to Sites for parent/child site hierarchy
-- Idempotent: only adds the column if it does not already exist.

IF NOT EXISTS (
  SELECT 1
  FROM   sys.columns
  WHERE  object_id = OBJECT_ID(N'dbo.Sites')
    AND  name      = N'ParentSiteID'
)
BEGIN
  ALTER TABLE dbo.Sites
    ADD ParentSiteID INT NULL
      CONSTRAINT FK_Sites_ParentSite
        FOREIGN KEY REFERENCES dbo.Sites(SiteID);
END
GO
