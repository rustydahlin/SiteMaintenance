-- Migration 023: Add PushSubscriptions table for PWA push notifications

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PushSubscriptions')
BEGIN
  CREATE TABLE PushSubscriptions (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    UserID    INT           NOT NULL,
    Endpoint  NVARCHAR(500) NOT NULL,
    P256dh    NVARCHAR(200) NOT NULL,
    Auth      NVARCHAR(100) NOT NULL,
    CreatedAt DATETIME2(0)  NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_PushSubs_User FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX UX_PushSubs_Endpoint ON PushSubscriptions(Endpoint);
  CREATE INDEX IX_PushSubs_User ON PushSubscriptions(UserID);
END
