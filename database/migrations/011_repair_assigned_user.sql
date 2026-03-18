-- 011_repair_assigned_user.sql
-- Adds AssignedUserID to RepairTracking for per-repair email notifications

ALTER TABLE RepairTracking
  ADD AssignedUserID INT NULL
  CONSTRAINT FK_Repair_AssignedUser FOREIGN KEY REFERENCES Users(UserID);
GO

-- Back-fill: default assigned user = the user who sent the item
UPDATE RepairTracking
SET AssignedUserID = SentByUserID
WHERE SentByUserID IS NOT NULL;
