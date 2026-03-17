-- Migration 006 — Add PartNumber, CommonName, RelatedSystemID to Inventory
-- Run this against an existing database. schema.sql already includes these columns for fresh installs.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'AssetTag')
    ALTER TABLE Inventory ADD AssetTag NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'PartNumber')
    ALTER TABLE Inventory ADD PartNumber NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'CommonName')
    ALTER TABLE Inventory ADD CommonName NVARCHAR(150) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'RelatedSystemID')
BEGIN
    ALTER TABLE Inventory ADD RelatedSystemID INT NULL;
    ALTER TABLE Inventory ADD CONSTRAINT FK_Inventory_RelatedSystem
        FOREIGN KEY (RelatedSystemID) REFERENCES Inventory(ItemID);
END
