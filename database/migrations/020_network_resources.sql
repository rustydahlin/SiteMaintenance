-- Migration 020: Network Resources module for tower map integration
-- Adds MonitoringLocationTypes, NetworkDeviceTypes, CircuitTypes lookup tables,
-- MonitoringLocationTypeID column to Sites, NetworkResources table,
-- and seeds the towerMap.apiKey AppSetting.

-- ── MonitoringLocationTypes ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'MonitoringLocationTypes' AND type = 'U')
BEGIN
  CREATE TABLE MonitoringLocationTypes (
    LocationTypeID  INT           IDENTITY(1,1) PRIMARY KEY,
    TypeName        NVARCHAR(100) NOT NULL,
    Description     NVARCHAR(255) NULL,
    IsActive        BIT           NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_MonitoringLocationTypes_TypeName UNIQUE (TypeName)
  );
END;

IF NOT EXISTS (SELECT 1 FROM MonitoringLocationTypes WHERE TypeName = 'Tower')
  INSERT INTO MonitoringLocationTypes (TypeName) VALUES ('Tower');
IF NOT EXISTS (SELECT 1 FROM MonitoringLocationTypes WHERE TypeName = 'PSAP')
  INSERT INTO MonitoringLocationTypes (TypeName) VALUES ('PSAP');

-- ── NetworkDeviceTypes ────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'NetworkDeviceTypes' AND type = 'U')
BEGIN
  CREATE TABLE NetworkDeviceTypes (
    DeviceTypeID  INT           IDENTITY(1,1) PRIMARY KEY,
    TypeName      NVARCHAR(100) NOT NULL,
    Description   NVARCHAR(255) NULL,
    IsActive      BIT           NOT NULL DEFAULT 1,
    CreatedAt     DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_NetworkDeviceTypes_TypeName UNIQUE (TypeName)
  );
END;

IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'SRX')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('SRX');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'MRG')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('MRG');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'CPoint')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('CPoint');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'PLink')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('PLink');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'PA')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('PA');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'Extreme')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('Extreme');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'CradlePoint')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('CradlePoint');
IF NOT EXISTS (SELECT 1 FROM NetworkDeviceTypes WHERE TypeName = 'Peplink')
  INSERT INTO NetworkDeviceTypes (TypeName) VALUES ('Peplink');

-- ── CircuitTypes ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'CircuitTypes' AND type = 'U')
BEGIN
  CREATE TABLE CircuitTypes (
    CircuitTypeID  INT           IDENTITY(1,1) PRIMARY KEY,
    TypeName       NVARCHAR(100) NOT NULL,
    Description    NVARCHAR(255) NULL,
    IsActive       BIT           NOT NULL DEFAULT 1,
    CreatedAt      DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_CircuitTypes_TypeName UNIQUE (TypeName)
  );
END;

IF NOT EXISTS (SELECT 1 FROM CircuitTypes WHERE TypeName = 'Fiber')
  INSERT INTO CircuitTypes (TypeName) VALUES ('Fiber');
IF NOT EXISTS (SELECT 1 FROM CircuitTypes WHERE TypeName = 'Microwave')
  INSERT INTO CircuitTypes (TypeName) VALUES ('Microwave');
IF NOT EXISTS (SELECT 1 FROM CircuitTypes WHERE TypeName = 'Satellite')
  INSERT INTO CircuitTypes (TypeName) VALUES ('Satellite');

-- ── Sites.MonitoringLocationTypeID ───────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('Sites') AND name = 'MonitoringLocationTypeID'
)
  ALTER TABLE Sites ADD MonitoringLocationTypeID INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Sites_MonitoringLocType')
  ALTER TABLE Sites ADD CONSTRAINT FK_Sites_MonitoringLocType
    FOREIGN KEY (MonitoringLocationTypeID) REFERENCES MonitoringLocationTypes(LocationTypeID);

-- ── NetworkResources ──────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'NetworkResources' AND type = 'U')
BEGIN
  CREATE TABLE NetworkResources (
    ResourceID        INT           IDENTITY(1,1) PRIMARY KEY,
    SiteID            INT           NOT NULL,
    Hostname          NVARCHAR(150) NOT NULL,
    IPAddress         NVARCHAR(45)  NULL,
    DeviceTypeID      INT           NOT NULL,
    AlertStatus       BIT           NOT NULL DEFAULT 1,
    SolarwindsNodeId  INT           NULL,
    CircuitTypeID     INT           NULL,
    CircuitID         NVARCHAR(150) NULL,
    Notes             NVARCHAR(MAX) NULL,
    SortOrder         INT           NOT NULL DEFAULT 0,
    IsActive          BIT           NOT NULL DEFAULT 1,
    CreatedAt         DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt         DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CreatedByUserID   INT           NULL,
    UpdatedByUserID   INT           NULL,
    CONSTRAINT FK_NetworkResources_Site        FOREIGN KEY (SiteID)          REFERENCES Sites(SiteID),
    CONSTRAINT FK_NetworkResources_DevType     FOREIGN KEY (DeviceTypeID)    REFERENCES NetworkDeviceTypes(DeviceTypeID),
    CONSTRAINT FK_NetworkResources_CircuitType FOREIGN KEY (CircuitTypeID)   REFERENCES CircuitTypes(CircuitTypeID),
    CONSTRAINT FK_NetworkResources_CreatedBy   FOREIGN KEY (CreatedByUserID) REFERENCES Users(UserID),
    CONSTRAINT FK_NetworkResources_UpdatedBy   FOREIGN KEY (UpdatedByUserID) REFERENCES Users(UserID)
  );

  CREATE INDEX IX_NetworkResources_SiteID   ON NetworkResources(SiteID);
  CREATE INDEX IX_NetworkResources_IsActive ON NetworkResources(IsActive);
END;

-- ── AppSettings: network map API key ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'networkMap.apiKey')
  INSERT INTO AppSettings (SettingKey, SettingValue, IsEncrypted, Description)
  VALUES (
    'networkMap.apiKey',
    NULL,
    1,
    'API key required by the network map app to call /api/network-map (X-API-Key header). Generate with: node -e "console.log(require(''crypto'').randomBytes(32).toString(''hex''))"'
  );
