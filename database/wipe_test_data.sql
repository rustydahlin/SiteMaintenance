-- =============================================================================
-- SiteMaintenance — Test Data Wipe Script
-- =============================================================================
-- PURPOSE: Remove all operational/test data before going to production.
--          Configuration, lookup tables, users, and settings are preserved.
--
-- KEEPS:   Users, UserRoles, Roles, AppSettings, SiteTypes, SiteStatuses,
--          LogTypes, InventoryCategories, InventoryStatuses, StockLocations,
--          MaintenanceTypes, KeyManufacturers,
--          UserNotifications (per-user preferences)
--
-- WIPES:   Sites, NetworkResources, MaintenanceItems, Inventory, SiteInventory,
--          InventoryStock, UserInventoryPossession, LogEntries, Documents,
--          DocumentData, RepairTracking, PMSchedules, Vendors, VendorContacts,
--          SystemKeys, AuditLog, Sessions
--
-- WARNING: THIS IS IRREVERSIBLE. Take a full database backup before running.
--          Do NOT run this against a production database with real data.
-- =============================================================================

-- NOTE: Change the database name below to match your environment.
-- If your tables are in a non-default schema, prefix each table reference
-- throughout this script with your schema name (e.g. myschema.Sites).
USE SiteMaintenance;
GO

-- Safety check: print a reminder and require an explicit variable to proceed.
-- Change @ConfirmWipe to 1 to actually run the script.
DECLARE @ConfirmWipe BIT = 0;

IF @ConfirmWipe = 0
BEGIN
    RAISERROR(
        'Wipe aborted. Set @ConfirmWipe = 1 at the top of this script to proceed.',
        16, 1
    );
    RETURN;
END

PRINT '== SiteMaintenance Test Data Wipe ==';
PRINT 'Started: ' + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT '';

-- ── 1. Document binary data ───────────────────────────────────────────────────
DELETE FROM DocumentData;
PRINT 'DocumentData:             ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 2. Document metadata ──────────────────────────────────────────────────────
DELETE FROM Documents;
PRINT 'Documents:                ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 3. Repair / RMA records ───────────────────────────────────────────────────
DELETE FROM RepairTracking;
PRINT 'RepairTracking:           ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 4. Bulk stock distribution ────────────────────────────────────────────────
DELETE FROM InventoryStock;
PRINT 'InventoryStock:           ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 5. Checkout history ───────────────────────────────────────────────────────
DELETE FROM UserInventoryPossession;
PRINT 'UserInventoryPossession:  ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 6. Site-installed equipment records ──────────────────────────────────────
DELETE FROM SiteInventory;
PRINT 'SiteInventory:            ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 7. PM schedules ───────────────────────────────────────────────────────────
DELETE FROM PMSchedules;
PRINT 'PMSchedules:              ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 7a. System Keys (must precede VendorContacts — FK_SK_Contact) ─────────────
DELETE FROM SystemKeys;
PRINT 'SystemKeys:               ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 7b. Vendor contacts ────────────────────────────────────────────────────────
DELETE FROM VendorContacts;
PRINT 'VendorContacts:           ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 7c. Vendors ────────────────────────────────────────────────────────────────
DELETE FROM Vendors;
PRINT 'Vendors:                  ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- KeyManufacturers is a lookup/settings table — not wiped.
-- MaintenanceTypes is a lookup/settings table — not wiped.

-- ── 7d. Maintenance items ──────────────────────────────────────────────────────
DELETE FROM MaintenanceItems;
PRINT 'MaintenanceItems:         ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 8. Log entries ────────────────────────────────────────────────────────────
DELETE FROM LogEntries;
PRINT 'LogEntries:               ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 9. Inventory items ────────────────────────────────────────────────────────
-- Self-referencing FK (RelatedSystemID) — clear it first, then delete all rows
UPDATE Inventory SET RelatedSystemID = NULL WHERE RelatedSystemID IS NOT NULL;
DELETE FROM Inventory;
PRINT 'Inventory:                ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 10. Network resources ─────────────────────────────────────────────────────
DELETE FROM NetworkResources;
PRINT 'NetworkResources:         ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 11. Sites ─────────────────────────────────────────────────────────────────
-- Self-referencing FK (ParentSiteID) — clear it first, then delete all rows
UPDATE Sites SET ParentSiteID = NULL WHERE ParentSiteID IS NOT NULL;
DELETE FROM Sites;
PRINT 'Sites:                    ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 12. Audit log ─────────────────────────────────────────────────────────────
DELETE FROM AuditLog;
PRINT 'AuditLog:                 ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── 13. Sessions ──────────────────────────────────────────────────────────────
DELETE FROM Sessions;
PRINT 'Sessions:                 ' + CAST(@@ROWCOUNT AS NVARCHAR) + ' rows deleted';

-- ── Reset identity counters (optional — requires db_owner or ALTER TABLE permission) ──────────
-- DBCC CHECKIDENT requires elevated permissions not held by a typical app write user.
-- Identity counters do not need to start at 1 for production; skip this in normal use.
-- If desired, a DBA can run the following block manually:
--
-- DBCC CHECKIDENT ('Documents',              RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('RepairTracking',         RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('InventoryStock',         RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('UserInventoryPossession',RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('SiteInventory',          RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('PMSchedules',            RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('VendorContacts',         RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('Vendors',                RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('SystemKeys',             RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('MaintenanceItems',       RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('LogEntries',             RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('Inventory',              RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('NetworkResources',       RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('Sites',                  RESEED, 0) WITH NO_INFOMSGS;
-- DBCC CHECKIDENT ('AuditLog',               RESEED, 0) WITH NO_INFOMSGS;

PRINT '';
PRINT 'Wipe complete: ' + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT 'Configuration, users, and lookup data are intact.';
GO
