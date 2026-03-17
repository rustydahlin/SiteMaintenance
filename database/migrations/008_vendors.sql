-- 008_vendors.sql
-- Adds Vendors, VendorContacts tables and AssignedVendorID on PMSchedules

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
    DoesPMWork  BIT NOT NULL DEFAULT 0,
    IsActive    BIT NOT NULL DEFAULT 1,
    CreatedAt   DATETIME2(0) NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt   DATETIME2(0) NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE VendorContacts (
    ContactID       INT IDENTITY(1,1) PRIMARY KEY,
    VendorID        INT NOT NULL,
    FirstName       NVARCHAR(100) NOT NULL,
    LastName        NVARCHAR(100) NULL,
    Title           NVARCHAR(150) NULL,
    Phone           NVARCHAR(50)  NULL,
    Email           NVARCHAR(255) NULL,
    ReceivePMEmails BIT NOT NULL DEFAULT 0,
    Notes           NVARCHAR(MAX) NULL,
    IsActive        BIT NOT NULL DEFAULT 1,
    CreatedAt       DATETIME2(0) NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_VC_Vendor FOREIGN KEY (VendorID) REFERENCES Vendors(VendorID)
);

ALTER TABLE PMSchedules
    ADD AssignedVendorID INT NULL
        CONSTRAINT FK_PMS_Vendor FOREIGN KEY REFERENCES Vendors(VendorID);
