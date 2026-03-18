-- 013_inventory_picklists.sql
-- Adds managed pick-list tables for Inventory Common Names, Model Numbers, and Manufacturers.
-- Seeds each table from distinct values already in the Inventory table.

CREATE TABLE InventoryCommonNames (
    CommonNameID INT IDENTITY(1,1) PRIMARY KEY,
    Name         NVARCHAR(150) NOT NULL,
    IsActive     BIT          NOT NULL DEFAULT 1,
    CreatedAt    DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE InventoryModelNumbers (
    ModelNumberID INT IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(150) NOT NULL,
    IsActive      BIT          NOT NULL DEFAULT 1,
    CreatedAt     DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE InventoryManufacturers (
    ManufacturerID INT IDENTITY(1,1) PRIMARY KEY,
    Name           NVARCHAR(150) NOT NULL,
    IsActive       BIT          NOT NULL DEFAULT 1,
    CreatedAt      DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);

-- Seed from existing inventory data
INSERT INTO InventoryCommonNames (Name)
SELECT DISTINCT CommonName FROM Inventory
WHERE CommonName IS NOT NULL AND LTRIM(RTRIM(CommonName)) != '';

INSERT INTO InventoryModelNumbers (Name)
SELECT DISTINCT ModelNumber FROM Inventory
WHERE ModelNumber IS NOT NULL AND LTRIM(RTRIM(ModelNumber)) != '';

INSERT INTO InventoryManufacturers (Name)
SELECT DISTINCT Manufacturer FROM Inventory
WHERE Manufacturer IS NOT NULL AND LTRIM(RTRIM(Manufacturer)) != '';
