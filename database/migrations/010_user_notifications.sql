-- 010_user_notifications.sql
-- Adds per-user email notification opt-in preferences

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

-- New role: grants access to Email Notification Preferences on the Profile page
INSERT INTO Roles (RoleName, Description)
VALUES ('Notifications', 'Can manage personal email notification preferences');
