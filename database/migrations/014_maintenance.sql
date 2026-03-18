-- Migration 014: Maintenance module
-- Adds MaintenanceTypes, MaintenanceItems tables.
-- Replaces SiteStatuses (Active, Offline, Decommissioned) with Current and Past-Due.
-- Adds Maintenance and Maintenance-Close roles.
-- Site status is now fully automated via application logic.

-- ── Roles ─────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Maintenance')
  INSERT INTO Roles (RoleName) VALUES ('Maintenance');

IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Maintenance-Close')
  INSERT INTO Roles (RoleName) VALUES ('Maintenance-Close');

-- ── SiteStatuses ──────────────────────────────────────────────────────────────
-- Add Current (green) — replaces Active/Offline/Decommissioned
IF NOT EXISTS (SELECT 1 FROM SiteStatuses WHERE StatusName = 'Current')
  INSERT INTO SiteStatuses (StatusName) VALUES ('Current');

-- Add Past-Due (red)
IF NOT EXISTS (SELECT 1 FROM SiteStatuses WHERE StatusName = 'Past-Due')
  INSERT INTO SiteStatuses (StatusName) VALUES ('Past-Due');

-- Default all sites to "Current" that currently have Active/Offline/Decommissioned
UPDATE Sites
SET SiteStatusID = (SELECT SiteStatusID FROM SiteStatuses WHERE StatusName = 'Current')
WHERE SiteStatusID IN (
  SELECT SiteStatusID FROM SiteStatuses
  WHERE StatusName IN ('Active', 'Offline', 'Decommissioned')
);

-- Deactivate removed statuses (keep data integrity; foreign key references now cleared above)
UPDATE SiteStatuses SET IsActive = 0 WHERE StatusName IN ('Active', 'Offline', 'Decommissioned');

-- ── MaintenanceTypes ──────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'MaintenanceTypes' AND type = 'U')
BEGIN
  CREATE TABLE MaintenanceTypes (
    MaintenanceTypeID INT IDENTITY(1,1) PRIMARY KEY,
    TypeName          NVARCHAR(100) NOT NULL,
    IsActive          BIT NOT NULL DEFAULT 1,
    CONSTRAINT UQ_MaintenanceTypes_TypeName UNIQUE (TypeName)
  );

  -- Seed with common types
  INSERT INTO MaintenanceTypes (TypeName) VALUES
    ('Inspection'),
    ('Repair'),
    ('Upgrade'),
    ('Configuration'),
    ('Other');
END;

-- ── MaintenanceItems ──────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'MaintenanceItems' AND type = 'U')
BEGIN
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
    CONSTRAINT FK_MaintenanceItems_Site     FOREIGN KEY (SiteID)           REFERENCES Sites(SiteID),
    CONSTRAINT FK_MaintenanceItems_User     FOREIGN KEY (AssignedToUserID) REFERENCES Users(UserID),
    CONSTRAINT FK_MaintenanceItems_ClosedBy FOREIGN KEY (ClosedByUserID)   REFERENCES Users(UserID),
    CONSTRAINT FK_MaintenanceItems_Type     FOREIGN KEY (MaintenanceTypeID) REFERENCES MaintenanceTypes(MaintenanceTypeID),
    CONSTRAINT FK_MaintenanceItems_Creator  FOREIGN KEY (CreatedByUserID)  REFERENCES Users(UserID)
  );
END;

-- ── AppSettings defaults ──────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'email.maintenanceReminderDays')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('email.maintenanceReminderDays', '3');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'email.maintenanceOverdueDays')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('email.maintenanceOverdueDays', '1');
