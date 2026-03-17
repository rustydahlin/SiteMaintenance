-- 009_system_keys.sql
-- Adds KeyManufacturers lookup, SystemKeys table, and SystemKeys role

-- ── Key Manufacturers lookup ───────────────────────────────────────────────────
CREATE TABLE KeyManufacturers (
    ManufacturerID   INT IDENTITY(1,1) PRIMARY KEY,
    ManufacturerName NVARCHAR(200) NOT NULL,
    Description      NVARCHAR(500) NULL,
    IsActive         BIT NOT NULL DEFAULT 1,
    CreatedAt        DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);

-- ── System Keys ────────────────────────────────────────────────────────────────
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

-- ── New role ───────────────────────────────────────────────────────────────────
INSERT INTO Roles (RoleName, Description)
VALUES ('SystemKeys', 'Can create and manage system keys');
