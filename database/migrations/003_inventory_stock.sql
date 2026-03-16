-- =============================================================================
-- Migration 003: InventoryStock — per-location/per-user quantity tracking for bulk items
-- Also adds PulledFromUserID to SiteInventory so installs can record "came from John's van"
-- =============================================================================

-- 1. InventoryStock: where bulk item quantities are held
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'InventoryStock' AND type = 'U')
BEGIN
    CREATE TABLE InventoryStock (
        StockID      INT           IDENTITY(1,1) PRIMARY KEY,
        ItemID       INT           NOT NULL,
        LocationID   INT           NULL,   -- at a stock location
        UserID       INT           NULL,   -- checked out to a person
        Quantity     INT           NOT NULL DEFAULT 0,
        Notes        NVARCHAR(255) NULL,
        UpdatedAt    DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_IStock_Item     FOREIGN KEY (ItemID)     REFERENCES Inventory(ItemID),
        CONSTRAINT FK_IStock_Location FOREIGN KEY (LocationID) REFERENCES StockLocations(LocationID),
        CONSTRAINT FK_IStock_User     FOREIGN KEY (UserID)     REFERENCES Users(UserID),
        CONSTRAINT CK_IStock_OneHolder CHECK (
            (LocationID IS NOT NULL AND UserID IS NULL) OR
            (LocationID IS NULL     AND UserID IS NOT NULL)
        )
    );
    CREATE INDEX IX_IStock_ItemID ON InventoryStock(ItemID);
END;

-- 2. PulledFromUserID on SiteInventory (records "came from this person's stock")
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SiteInventory') AND name = 'PulledFromUserID')
BEGIN
    ALTER TABLE SiteInventory ADD PulledFromUserID INT NULL;
    ALTER TABLE SiteInventory ADD CONSTRAINT FK_SI_PulledFromUser
        FOREIGN KEY (PulledFromUserID) REFERENCES Users(UserID);
END;
