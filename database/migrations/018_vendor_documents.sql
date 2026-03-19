-- Migration 018: Add VendorID to Documents table

ALTER TABLE Documents
  ADD VendorID INT NULL
  CONSTRAINT FK_Doc_Vendor FOREIGN KEY REFERENCES Vendors(VendorID);
GO

-- Drop old check constraint (allowed exactly 1 of 3), replace with 4-way version
ALTER TABLE Documents DROP CONSTRAINT CHK_Doc_OneOwner;
GO

ALTER TABLE Documents ADD CONSTRAINT CHK_Doc_OneOwner CHECK (
  (CASE WHEN LogEntryID IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN SiteID     IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN ItemID     IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN VendorID   IS NOT NULL THEN 1 ELSE 0 END) = 1
);
GO

CREATE INDEX IX_Doc_VendorID ON Documents(VendorID) WHERE VendorID IS NOT NULL;
GO
