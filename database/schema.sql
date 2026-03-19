-- =============================================================================
-- SiteMaintenance Database Schema
-- Run this script against an empty SQL Server database before starting the app.
-- =============================================================================

-- ============================================================
-- SESSIONS (express-session store via connect-mssql-v2)
-- ============================================================
CREATE TABLE Sessions (
    sid      NVARCHAR(255) NOT NULL PRIMARY KEY,
    session  NVARCHAR(MAX) NOT NULL,
    expires  DATETIME2(0)  NOT NULL
);
CREATE INDEX IX_Sessions_expires ON Sessions(expires);

-- ============================================================
-- ROLES
-- ============================================================
CREATE TABLE Roles (
    RoleID      INT IDENTITY(1,1) PRIMARY KEY,
    RoleName    NVARCHAR(50)  NOT NULL UNIQUE,
    Description NVARCHAR(255) NULL
);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE Users (
    UserID          INT IDENTITY(1,1) PRIMARY KEY,
    Username        NVARCHAR(100) NOT NULL UNIQUE,
    DisplayName     NVARCHAR(150) NOT NULL,
    Organization    NVARCHAR(150) NULL,
    Email           NVARCHAR(255) NULL,
    PasswordHash    NVARCHAR(255) NULL,
    AuthProvider    NVARCHAR(20)  NOT NULL DEFAULT 'local',  -- local, oidc, ldap
    ExternalID      NVARCHAR(255) NULL,
    IsActive        BIT           NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    LastLoginAt     DATETIME2(0)  NULL,
    CreatedByUserID INT           NULL,
    CONSTRAINT FK_Users_CreatedBy FOREIGN KEY (CreatedByUserID) REFERENCES Users(UserID)
);
CREATE INDEX IX_Users_Username   ON Users(Username);
CREATE INDEX IX_Users_Email      ON Users(Email) WHERE Email IS NOT NULL;
CREATE INDEX IX_Users_ExternalID ON Users(ExternalID) WHERE ExternalID IS NOT NULL;

CREATE TABLE UserRoles (
    UserID           INT          NOT NULL,
    RoleID           INT          NOT NULL,
    AssignedAt       DATETIME2(0) NOT NULL DEFAULT GETUTCDATE(),
    AssignedByUserID INT          NULL,
    CONSTRAINT PK_UserRoles       PRIMARY KEY (UserID, RoleID),
    CONSTRAINT FK_UserRoles_User  FOREIGN KEY (UserID)           REFERENCES Users(UserID),
    CONSTRAINT FK_UserRoles_Role  FOREIGN KEY (RoleID)           REFERENCES Roles(RoleID),
    CONSTRAINT FK_UserRoles_By    FOREIGN KEY (AssignedByUserID) REFERENCES Users(UserID)
);

-- ============================================================
-- APP SETTINGS (admin-editable; DB values override .env)
-- ============================================================
CREATE TABLE AppSettings (
    SettingID       INT           IDENTITY(1,1) PRIMARY KEY,
    SettingKey      NVARCHAR(100) NOT NULL UNIQUE,
    SettingValue    NVARCHAR(MAX) NULL,
    IsEncrypted     BIT           NOT NULL DEFAULT 0,
    Description     NVARCHAR(500) NULL,
    UpdatedAt       DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    UpdatedByUserID INT           NULL,
    CONSTRAINT FK_AppSettings_User FOREIGN KEY (UpdatedByUserID) REFERENCES Users(UserID)
);

-- ============================================================
-- LOOKUP / CONFIGURATION TABLES
-- ============================================================
CREATE TABLE SiteTypes (
    SiteTypeID  INT           IDENTITY(1,1) PRIMARY KEY,
    TypeName    NVARCHAR(100) NOT NULL UNIQUE,
    Description NVARCHAR(255) NULL,
    IsActive    BIT           NOT NULL DEFAULT 1,
    CreatedAt   DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE SiteStatuses (
    SiteStatusID INT           IDENTITY(1,1) PRIMARY KEY,
    StatusName   NVARCHAR(50)  NOT NULL UNIQUE,
    IsActive     BIT           NOT NULL DEFAULT 1
);

CREATE TABLE MaintenanceTypes (
    MaintenanceTypeID INT           IDENTITY(1,1) PRIMARY KEY,
    TypeName          NVARCHAR(100) NOT NULL,
    IsActive          BIT           NOT NULL DEFAULT 1,
    CONSTRAINT UQ_MaintenanceTypes_TypeName UNIQUE (TypeName)
);

CREATE TABLE LogTypes (
    LogTypeID   INT           IDENTITY(1,1) PRIMARY KEY,
    TypeName    NVARCHAR(100) NOT NULL UNIQUE,
    IsAutomatic BIT           NOT NULL DEFAULT 0,
    IsActive    BIT           NOT NULL DEFAULT 1
);

CREATE TABLE InventoryCommonNames (
    CommonNameID INT           IDENTITY(1,1) PRIMARY KEY,
    Name         NVARCHAR(150) NOT NULL,
    IsActive     BIT           NOT NULL DEFAULT 1,
    CreatedAt    DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE InventoryModelNumbers (
    ModelNumberID INT           IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(150) NOT NULL,
    IsActive      BIT           NOT NULL DEFAULT 1,
    CreatedAt     DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE InventoryManufacturers (
    ManufacturerID INT           IDENTITY(1,1) PRIMARY KEY,
    Name           NVARCHAR(150) NOT NULL,
    IsActive       BIT           NOT NULL DEFAULT 1,
    CreatedAt      DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE InventoryCategories (
    CategoryID   INT           IDENTITY(1,1) PRIMARY KEY,
    CategoryName NVARCHAR(100) NOT NULL UNIQUE,
    Description  NVARCHAR(255) NULL,
    IsActive     BIT           NOT NULL DEFAULT 1,
    CreatedAt    DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE InventoryStatuses (
    StatusID   INT          IDENTITY(1,1) PRIMARY KEY,
    StatusName NVARCHAR(50) NOT NULL UNIQUE
    -- In-Stock, Deployed, In-Repair, Retired, Checked-Out
);

CREATE TABLE StockLocations (
    LocationID   INT           IDENTITY(1,1) PRIMARY KEY,
    LocationName NVARCHAR(150) NOT NULL UNIQUE,
    Description  NVARCHAR(500) NULL,
    IsActive     BIT           NOT NULL DEFAULT 1,
    CreatedAt    DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE()
);

-- ============================================================
-- SITES
-- ============================================================
CREATE TABLE Sites (
    SiteID          INT             IDENTITY(1,1) PRIMARY KEY,
    SiteName        NVARCHAR(150)   NOT NULL,
    SiteNumber      NVARCHAR(100)   NULL,
    ContractNumber  NVARCHAR(100)   NULL,
    SiteTypeID      INT             NOT NULL,
    SiteStatusID    INT             NOT NULL,
    Address         NVARCHAR(500)   NULL,
    City            NVARCHAR(100)   NULL,
    State           NVARCHAR(50)    NULL,
    ZipCode         NVARCHAR(20)    NULL,
    Latitude        DECIMAL(10,7)   NULL,
    Longitude       DECIMAL(10,7)   NULL,
    Description     NVARCHAR(MAX)   NULL,
    WarrantyExpires DATE            NULL,
    ParentSiteID    INT             NULL,       -- NULL = top-level site; set for sub-sites
    IsActive        BIT             NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0)    NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt       DATETIME2(0)    NOT NULL DEFAULT GETUTCDATE(),
    CreatedByUserID INT             NULL,
    CONSTRAINT FK_Sites_SiteType   FOREIGN KEY (SiteTypeID)   REFERENCES SiteTypes(SiteTypeID),
    CONSTRAINT FK_Sites_SiteStatus FOREIGN KEY (SiteStatusID) REFERENCES SiteStatuses(SiteStatusID),
    CONSTRAINT FK_Sites_CreatedBy  FOREIGN KEY (CreatedByUserID) REFERENCES Users(UserID),
    CONSTRAINT FK_Sites_ParentSite FOREIGN KEY (ParentSiteID) REFERENCES Sites(SiteID)
);
CREATE INDEX IX_Sites_SiteTypeID   ON Sites(SiteTypeID);
CREATE INDEX IX_Sites_SiteStatusID ON Sites(SiteStatusID);
CREATE INDEX IX_Sites_IsActive     ON Sites(IsActive);

-- ============================================================
-- INVENTORY
-- ============================================================
CREATE TABLE Inventory (
    ItemID            INT           IDENTITY(1,1) PRIMARY KEY,
    TrackingType      NVARCHAR(20)  NOT NULL DEFAULT 'serialized', -- 'serialized' | 'bulk'
    SerialNumber      NVARCHAR(100) NULL,      -- required for serialized, optional for bulk
    AssetTag          NVARCHAR(100) NULL,      -- optional asset tag / property tag number (serialized only)
    CommonName        NVARCHAR(150) NULL,      -- friendly/display name (e.g. "Spare VMS NIC")
    PartNumber        NVARCHAR(100) NULL,      -- manufacturer part number
    ModelNumber       NVARCHAR(100) NULL,
    Manufacturer      NVARCHAR(150) NULL,
    CategoryID        INT           NOT NULL,
    StatusID          INT           NOT NULL,
    StockLocationID   INT           NULL,      -- set when In-Stock (serialized only)
    AssignedToUserID  INT           NULL,      -- set when Checked-Out (serialized only)
    QuantityTotal     INT           NOT NULL DEFAULT 1, -- bulk: total units owned; serialized: always 1
    RelatedSystemID   INT           NULL,      -- optional link to a "parent" inventory item (the system this is a part for)
    Description       NVARCHAR(MAX) NULL,
    PurchaseDate      DATE          NULL,
    WarrantyExpires   DATE          NULL,
    Notes             NVARCHAR(MAX) NULL,
    IsActive          BIT           NOT NULL DEFAULT 1,
    CreatedAt         DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt         DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CreatedByUserID   INT           NULL,
    CONSTRAINT FK_Inventory_Category      FOREIGN KEY (CategoryID)       REFERENCES InventoryCategories(CategoryID),
    CONSTRAINT FK_Inventory_Status        FOREIGN KEY (StatusID)         REFERENCES InventoryStatuses(StatusID),
    CONSTRAINT FK_Inventory_StockLocation FOREIGN KEY (StockLocationID)  REFERENCES StockLocations(LocationID),
    CONSTRAINT FK_Inventory_AssignedTo    FOREIGN KEY (AssignedToUserID) REFERENCES Users(UserID),
    CONSTRAINT FK_Inventory_CreatedBy     FOREIGN KEY (CreatedByUserID)  REFERENCES Users(UserID),
    CONSTRAINT FK_Inventory_RelatedSystem FOREIGN KEY (RelatedSystemID)  REFERENCES Inventory(ItemID)
);
CREATE UNIQUE INDEX IX_Inventory_SerialNumber ON Inventory(SerialNumber) WHERE SerialNumber IS NOT NULL;
CREATE INDEX IX_Inventory_CategoryID     ON Inventory(CategoryID);
CREATE INDEX IX_Inventory_StatusID       ON Inventory(StatusID);
CREATE INDEX IX_Inventory_StockLocation  ON Inventory(StockLocationID) WHERE StockLocationID IS NOT NULL;
CREATE INDEX IX_Inventory_AssignedToUser ON Inventory(AssignedToUserID) WHERE AssignedToUserID IS NOT NULL;

CREATE TABLE UserInventoryPossession (
    PossessionID         INT           IDENTITY(1,1) PRIMARY KEY,
    ItemID               INT           NOT NULL,
    UserID               INT           NOT NULL,
    CheckedOutAt         DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CheckedInAt          DATETIME2(0)  NULL,
    PulledFromLocationID INT           NULL,
    Notes                NVARCHAR(500) NULL,
    RecordedByUserID     INT           NULL,
    CONSTRAINT FK_UIP_Item        FOREIGN KEY (ItemID)               REFERENCES Inventory(ItemID),
    CONSTRAINT FK_UIP_User        FOREIGN KEY (UserID)               REFERENCES Users(UserID),
    CONSTRAINT FK_UIP_Location    FOREIGN KEY (PulledFromLocationID) REFERENCES StockLocations(LocationID),
    CONSTRAINT FK_UIP_RecordedBy  FOREIGN KEY (RecordedByUserID)     REFERENCES Users(UserID)
);
CREATE INDEX IX_UIP_ItemID          ON UserInventoryPossession(ItemID);
CREATE INDEX IX_UIP_UserID          ON UserInventoryPossession(UserID);
CREATE INDEX IX_UIP_OpenPossession  ON UserInventoryPossession(ItemID, CheckedInAt) WHERE CheckedInAt IS NULL;

-- ============================================================
-- LOG ENTRIES (created before SiteInventory to resolve FK order)
-- ============================================================
CREATE TABLE LogEntries (
    LogEntryID        INT           IDENTITY(1,1) PRIMARY KEY,
    SiteID            INT           NOT NULL,
    LogTypeID         INT           NOT NULL,
    EntryDate         DATETIME2(0)  NOT NULL,
    PerformedBy       NVARCHAR(200) NULL,
    PerformedByUserID INT           NULL,
    Subject           NVARCHAR(300) NULL,
    Description       NVARCHAR(MAX) NULL,
    Notes             NVARCHAR(MAX) NULL,
    IsAutoGenerated   BIT           NOT NULL DEFAULT 0,
    CreatedAt         DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CreatedByUserID   INT           NULL,
    CONSTRAINT FK_Log_Site        FOREIGN KEY (SiteID)            REFERENCES Sites(SiteID),
    CONSTRAINT FK_Log_LogType     FOREIGN KEY (LogTypeID)         REFERENCES LogTypes(LogTypeID),
    CONSTRAINT FK_Log_PerformedBy FOREIGN KEY (PerformedByUserID) REFERENCES Users(UserID),
    CONSTRAINT FK_Log_CreatedBy   FOREIGN KEY (CreatedByUserID)   REFERENCES Users(UserID)
);
CREATE INDEX IX_Log_SiteID    ON LogEntries(SiteID);
CREATE INDEX IX_Log_LogTypeID ON LogEntries(LogTypeID);
CREATE INDEX IX_Log_EntryDate ON LogEntries(EntryDate DESC);

-- ============================================================
-- SITE INVENTORY (install/remove history)
-- ============================================================
CREATE TABLE SiteInventory (
    SiteInventoryID      INT           IDENTITY(1,1) PRIMARY KEY,
    SiteID               INT           NOT NULL,
    ItemID               INT           NOT NULL,
    Quantity             INT           NOT NULL DEFAULT 1, -- bulk: units deployed; serialized: always 1
    InstalledAt          DATETIME2(0)  NOT NULL,
    InstalledByUserID    INT           NULL,
    InstallNotes         NVARCHAR(MAX) NULL,
    PulledFromLocationID INT           NULL,
    PulledFromUserID     INT           NULL,   -- pulled from a person's stock
    RemovedAt            DATETIME2(0)  NULL,
    RemovedByUserID      INT           NULL,
    RemovalNotes         NVARCHAR(MAX) NULL,
    InstallLogEntryID    INT           NULL,
    RemovalLogEntryID    INT           NULL,
    CONSTRAINT FK_SI_Site           FOREIGN KEY (SiteID)               REFERENCES Sites(SiteID),
    CONSTRAINT FK_SI_Item           FOREIGN KEY (ItemID)               REFERENCES Inventory(ItemID),
    CONSTRAINT FK_SI_InstalledBy    FOREIGN KEY (InstalledByUserID)    REFERENCES Users(UserID),
    CONSTRAINT FK_SI_RemovedBy      FOREIGN KEY (RemovedByUserID)      REFERENCES Users(UserID),
    CONSTRAINT FK_SI_Location       FOREIGN KEY (PulledFromLocationID) REFERENCES StockLocations(LocationID),
    CONSTRAINT FK_SI_PulledFromUser FOREIGN KEY (PulledFromUserID)     REFERENCES Users(UserID),
    CONSTRAINT FK_SI_InstallLog     FOREIGN KEY (InstallLogEntryID)    REFERENCES LogEntries(LogEntryID),
    CONSTRAINT FK_SI_RemovalLog     FOREIGN KEY (RemovalLogEntryID)    REFERENCES LogEntries(LogEntryID)
);

-- ============================================================
-- INVENTORY STOCK (bulk item quantity distribution)
-- ============================================================
CREATE TABLE InventoryStock (
    StockID    INT           IDENTITY(1,1) PRIMARY KEY,
    ItemID     INT           NOT NULL,
    LocationID INT           NULL,   -- at a stock location
    UserID     INT           NULL,   -- with a person
    Quantity   INT           NOT NULL DEFAULT 0,
    Notes      NVARCHAR(255) NULL,
    UpdatedAt  DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_IStock_Item     FOREIGN KEY (ItemID)     REFERENCES Inventory(ItemID),
    CONSTRAINT FK_IStock_Location FOREIGN KEY (LocationID) REFERENCES StockLocations(LocationID),
    CONSTRAINT FK_IStock_User     FOREIGN KEY (UserID)     REFERENCES Users(UserID),
    CONSTRAINT CK_IStock_OneHolder CHECK (
        (LocationID IS NOT NULL AND UserID IS NULL) OR
        (LocationID IS NULL     AND UserID IS NOT NULL)
    )
);
CREATE INDEX IX_IStock_ItemID ON InventoryStock(ItemID);
CREATE INDEX IX_SI_SiteID  ON SiteInventory(SiteID);
CREATE INDEX IX_SI_ItemID  ON SiteInventory(ItemID);
CREATE INDEX IX_SI_Current ON SiteInventory(SiteID, RemovedAt) WHERE RemovedAt IS NULL;

-- ============================================================
-- REPAIR / RMA TRACKING
-- ============================================================
CREATE TABLE RepairTracking (
    RepairID             INT           IDENTITY(1,1) PRIMARY KEY,
    ItemID               INT           NOT NULL,
    SiteInventoryID      INT           NULL,
    SentDate             DATE          NULL,
    RMANumber            NVARCHAR(100) NULL,
    ManufacturerContact  NVARCHAR(255) NULL,
    Reason               NVARCHAR(MAX) NOT NULL,
    ExpectedReturnDate   DATE          NULL,
    FollowUpDate         DATE          NULL,
    ReceivedDate         DATE          NULL,
    ReturnCondition      NVARCHAR(100) NULL,
    ReturnNotes          NVARCHAR(MAX) NULL,
    RepairStatus         NVARCHAR(50)  NOT NULL DEFAULT 'Sent',
    -- 'Sent', 'FollowUp-Pending', 'Received', 'Returned-to-Inventory', 'Retired'
    SentByUserID         INT           NULL,
    ReceivedByUserID     INT           NULL,
    AssignedUserID       INT           NULL,
    CreatedAt            DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt            DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Repair_Item       FOREIGN KEY (ItemID)           REFERENCES Inventory(ItemID),
    CONSTRAINT FK_Repair_SI         FOREIGN KEY (SiteInventoryID)  REFERENCES SiteInventory(SiteInventoryID),
    CONSTRAINT FK_Repair_SentBy     FOREIGN KEY (SentByUserID)     REFERENCES Users(UserID),
    CONSTRAINT FK_Repair_RecvdBy    FOREIGN KEY (ReceivedByUserID) REFERENCES Users(UserID),
    CONSTRAINT FK_Repair_AssignedUser FOREIGN KEY (AssignedUserID) REFERENCES Users(UserID)
);
CREATE INDEX IX_Repair_ItemID ON RepairTracking(ItemID);
CREATE INDEX IX_Repair_Status ON RepairTracking(RepairStatus);

-- ============================================================
-- VENDORS / CONTRACTORS
-- ============================================================
CREATE TABLE Vendors (
    VendorID    INT IDENTITY(1,1) PRIMARY KEY,
    VendorName  NVARCHAR(200) NOT NULL,
    Phone       NVARCHAR(50)  NULL,
    Email       NVARCHAR(255) NULL,
    Address     NVARCHAR(500) NULL,
    City        NVARCHAR(100) NULL,
    State       NVARCHAR(50)  NULL,
    Zip         NVARCHAR(20)  NULL,
    Website     NVARCHAR(255) NULL,
    Notes       NVARCHAR(MAX) NULL,
    DoesPMWork  BIT NOT NULL DEFAULT 0,  -- if 1, appears in PM Assigned To
    IsActive    BIT NOT NULL DEFAULT 1,
    CreatedAt   DATETIME2(0) NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);
CREATE INDEX IX_Vendors_Name ON Vendors(VendorName);

CREATE TABLE VendorContacts (
    ContactID       INT IDENTITY(1,1) PRIMARY KEY,
    VendorID        INT NOT NULL,
    FirstName       NVARCHAR(100) NOT NULL,
    LastName        NVARCHAR(100) NULL,
    Title           NVARCHAR(150) NULL,
    Phone           NVARCHAR(50)  NULL,
    Email           NVARCHAR(255) NULL,
    ReceivePMEmails BIT NOT NULL DEFAULT 0,  -- if 1, receives PM cron emails
    Notes           NVARCHAR(MAX) NULL,
    IsActive        BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0) NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_VC_Vendor FOREIGN KEY (VendorID) REFERENCES Vendors(VendorID)
);
CREATE INDEX IX_VC_VendorID ON VendorContacts(VendorID);

-- ============================================================
-- PM SCHEDULES
-- ============================================================
CREATE TABLE PMSchedules (
    ScheduleID       INT           IDENTITY(1,1) PRIMARY KEY,
    SiteID           INT           NOT NULL,
    Title            NVARCHAR(200) NOT NULL,
    FrequencyDays    INT           NOT NULL,
    LastPerformedAt  DATE          NULL,
    AssignedUserID   INT           NULL,
    AssignedVendorID INT           NULL,
    IsActive         BIT           NOT NULL DEFAULT 1,
    Notes            NVARCHAR(MAX) NULL,
    CreatedAt        DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_PMS_Site   FOREIGN KEY (SiteID)           REFERENCES Sites(SiteID),
    CONSTRAINT FK_PMS_User   FOREIGN KEY (AssignedUserID)   REFERENCES Users(UserID),
    CONSTRAINT FK_PMS_Vendor FOREIGN KEY (AssignedVendorID) REFERENCES Vendors(VendorID)
);
CREATE INDEX IX_PMS_SiteID ON PMSchedules(SiteID);

-- ============================================================
-- DOCUMENTS (metadata only; binary data in DocumentData)
-- ============================================================
CREATE TABLE Documents (
    DocumentID       INT           IDENTITY(1,1) PRIMARY KEY,
    OriginalFilename NVARCHAR(500) NOT NULL,
    MimeType         NVARCHAR(200) NOT NULL,
    FileSizeBytes    BIGINT        NOT NULL,
    UploadedAt       DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    UploadedByUserID INT           NULL,
    Description      NVARCHAR(500) NULL,
    -- Polymorphic: exactly one of these must be non-NULL
    LogEntryID       INT           NULL,
    SiteID           INT           NULL,
    ItemID           INT           NULL,
    VendorID         INT           NULL,
    CONSTRAINT FK_Doc_LogEntry   FOREIGN KEY (LogEntryID)       REFERENCES LogEntries(LogEntryID),
    CONSTRAINT FK_Doc_Site       FOREIGN KEY (SiteID)           REFERENCES Sites(SiteID),
    CONSTRAINT FK_Doc_Item       FOREIGN KEY (ItemID)           REFERENCES Inventory(ItemID),
    CONSTRAINT FK_Doc_Vendor     FOREIGN KEY (VendorID)         REFERENCES Vendors(VendorID),
    CONSTRAINT FK_Doc_UploadedBy FOREIGN KEY (UploadedByUserID) REFERENCES Users(UserID),
    CONSTRAINT CHK_Doc_OneOwner  CHECK (
        (CASE WHEN LogEntryID IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN SiteID     IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN ItemID     IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN VendorID   IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);
CREATE INDEX IX_Doc_LogEntryID ON Documents(LogEntryID) WHERE LogEntryID IS NOT NULL;
CREATE INDEX IX_Doc_SiteID     ON Documents(SiteID)     WHERE SiteID IS NOT NULL;
CREATE INDEX IX_Doc_ItemID     ON Documents(ItemID)     WHERE ItemID IS NOT NULL;
CREATE INDEX IX_Doc_VendorID   ON Documents(VendorID)   WHERE VendorID IS NOT NULL;

-- Separate table for binary data to keep Documents metadata rows fast
CREATE TABLE DocumentData (
    DocumentID INT            NOT NULL PRIMARY KEY,
    FileData   VARBINARY(MAX) NOT NULL,
    CONSTRAINT FK_DocData_Document FOREIGN KEY (DocumentID) REFERENCES Documents(DocumentID) ON DELETE CASCADE
);

-- ============================================================
-- KEY MANUFACTURERS (lookup)
-- ============================================================
CREATE TABLE KeyManufacturers (
    ManufacturerID   INT IDENTITY(1,1) PRIMARY KEY,
    ManufacturerName NVARCHAR(200) NOT NULL,
    Description      NVARCHAR(500) NULL,
    IsActive         BIT NOT NULL DEFAULT 1,
    CreatedAt        DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);

-- ============================================================
-- SYSTEM KEYS
-- ============================================================
CREATE TABLE SystemKeys (
    KeyID               INT IDENTITY(1,1) PRIMARY KEY,
    IssuedToUserID      INT           NULL,
    IssuedToContactID   INT           NULL,
    ManufacturerID      INT           NULL,
    DateIssued          DATE          NULL,
    ExpirationDate      DATE          NULL,
    LastRenewalDate     DATE          NULL,
    KeyCode             NVARCHAR(100) NULL,
    SerialNumber        NVARCHAR(100) NULL,
    KeyType             NVARCHAR(20)  NOT NULL DEFAULT 'Unlimited',
    Notes               NVARCHAR(MAX) NULL,
    IsActive            BIT NOT NULL DEFAULT 1,
    LastUpdatedByUserID INT           NULL,
    CreatedAt           DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt           DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_SK_User         FOREIGN KEY (IssuedToUserID)      REFERENCES Users(UserID),
    CONSTRAINT FK_SK_Contact      FOREIGN KEY (IssuedToContactID)   REFERENCES VendorContacts(ContactID),
    CONSTRAINT FK_SK_Manufacturer FOREIGN KEY (ManufacturerID)      REFERENCES KeyManufacturers(ManufacturerID),
    CONSTRAINT FK_SK_UpdatedBy    FOREIGN KEY (LastUpdatedByUserID) REFERENCES Users(UserID)
);
CREATE INDEX IX_SK_IssuedToUser    ON SystemKeys(IssuedToUserID)    WHERE IssuedToUserID    IS NOT NULL;
CREATE INDEX IX_SK_IssuedToContact ON SystemKeys(IssuedToContactID) WHERE IssuedToContactID IS NOT NULL;
CREATE INDEX IX_SK_Expiry          ON SystemKeys(ExpirationDate)    WHERE IsActive = 1;

-- ============================================================
-- USER NOTIFICATION PREFERENCES
-- ============================================================
CREATE TABLE UserNotifications (
    NotificationID   INT IDENTITY(1,1) PRIMARY KEY,
    UserID           INT          NOT NULL,
    NotificationType NVARCHAR(50) NOT NULL,
    IsEnabled        BIT          NOT NULL DEFAULT 0,
    UpdatedAt        DATETIME2(0) NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_UN_User FOREIGN KEY (UserID) REFERENCES Users(UserID),
    CONSTRAINT UQ_UN_UserType UNIQUE (UserID, NotificationType)
);
CREATE INDEX IX_UN_UserID ON UserNotifications(UserID);

-- ============================================================
-- MAINTENANCE ITEMS
-- ============================================================
CREATE TABLE MaintenanceItems (
    MaintenanceID       INT IDENTITY(1,1) PRIMARY KEY,
    SiteID              INT NOT NULL,
    AssignedToUserID    INT NULL,
    MaintenanceTypeID   INT NULL,
    DueDate             DATE NULL,
    ExternalReference   NVARCHAR(100) NULL,
    WorkToComplete      NVARCHAR(MAX) NULL,
    ClosedAt            DATETIME2 NULL,
    ClosedByUserID      INT NULL,
    ClosureNotes        NVARCHAR(MAX) NULL,
    IsActive            BIT NOT NULL DEFAULT 1,
    CreatedAt           DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CreatedByUserID     INT NULL,
    CONSTRAINT FK_MaintenanceItems_Site     FOREIGN KEY (SiteID)            REFERENCES Sites(SiteID),
    CONSTRAINT FK_MaintenanceItems_User     FOREIGN KEY (AssignedToUserID)  REFERENCES Users(UserID),
    CONSTRAINT FK_MaintenanceItems_ClosedBy FOREIGN KEY (ClosedByUserID)    REFERENCES Users(UserID),
    CONSTRAINT FK_MaintenanceItems_Type     FOREIGN KEY (MaintenanceTypeID) REFERENCES MaintenanceTypes(MaintenanceTypeID),
    CONSTRAINT FK_MaintenanceItems_Creator  FOREIGN KEY (CreatedByUserID)   REFERENCES Users(UserID)
);
CREATE INDEX IX_MI_SiteID   ON MaintenanceItems(SiteID);
CREATE INDEX IX_MI_Assigned ON MaintenanceItems(AssignedToUserID);
CREATE INDEX IX_MI_DueDate  ON MaintenanceItems(DueDate) WHERE DueDate IS NOT NULL;

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE AuditLog (
    AuditID         INT           IDENTITY(1,1) PRIMARY KEY,
    TableName       NVARCHAR(100) NOT NULL,
    RecordID        INT           NULL,
    Action          NVARCHAR(50)  NOT NULL,
    ChangedByUserID INT           NULL,
    ChangedAt       DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    OldValues       NVARCHAR(MAX) NULL,  -- JSON
    NewValues       NVARCHAR(MAX) NULL,  -- JSON
    IPAddress       NVARCHAR(45)  NULL,
    UserAgent       NVARCHAR(500) NULL,
    Notes           NVARCHAR(500) NULL
);
CREATE INDEX IX_Audit_Table     ON AuditLog(TableName, RecordID);
CREATE INDEX IX_Audit_ChangedBy ON AuditLog(ChangedByUserID);
CREATE INDEX IX_Audit_ChangedAt ON AuditLog(ChangedAt DESC);
