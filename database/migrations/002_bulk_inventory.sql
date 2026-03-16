-- =============================================================================
-- Migration 002: Bulk/FRU Inventory Support
-- Run against an existing database that already has migration 001 applied.
-- =============================================================================

-- 1. Drop any existing index on SerialNumber BEFORE altering the column
--    (SQL Server won't let you alter a column that an index depends on)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Inventory') AND name = 'IX_Inventory_SerialNumber')
    DROP INDEX IX_Inventory_SerialNumber ON Inventory;

-- 2. Drop ALL unique constraints on the Inventory table that cover SerialNumber
--    (SQL Server auto-generates names like UQ__Inventor__048A0008A9D8D5E5 — not predictable)
DECLARE @con NVARCHAR(200);
DECLARE @sql NVARCHAR(500);
DECLARE cur CURSOR FOR
    SELECT kc.name
    FROM   sys.key_constraints kc
    JOIN   sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    JOIN   sys.columns col      ON col.object_id = ic.object_id AND col.column_id = ic.column_id
    WHERE  kc.parent_object_id = OBJECT_ID('Inventory')
      AND  kc.type = 'UQ'
      AND  col.name = 'SerialNumber';
OPEN cur;
FETCH NEXT FROM cur INTO @con;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = 'ALTER TABLE Inventory DROP CONSTRAINT [' + @con + ']';
    EXEC(@sql);
    FETCH NEXT FROM cur INTO @con;
END;
CLOSE cur;
DEALLOCATE cur;

-- 3. Now safe to make SerialNumber nullable
ALTER TABLE Inventory ALTER COLUMN SerialNumber NVARCHAR(100) NULL;

-- 4. Recreate as a filtered unique index (allows multiple NULLs)
CREATE UNIQUE INDEX IX_Inventory_SerialNumber ON Inventory(SerialNumber) WHERE SerialNumber IS NOT NULL;

-- 4. Add TrackingType  ('serialized' | 'bulk')
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'TrackingType')
    ALTER TABLE Inventory ADD TrackingType NVARCHAR(20) NOT NULL DEFAULT 'serialized';

-- 5. Add QuantityTotal  (serialized = always 1; bulk = total units owned)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Inventory') AND name = 'QuantityTotal')
    ALTER TABLE Inventory ADD QuantityTotal INT NOT NULL DEFAULT 1;

-- 6. Add Quantity to SiteInventory  (serialized = always 1; bulk = units deployed)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SiteInventory') AND name = 'Quantity')
    ALTER TABLE SiteInventory ADD Quantity INT NOT NULL DEFAULT 1;
