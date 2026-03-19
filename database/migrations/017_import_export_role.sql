-- Migration 017: Add ImportExport role
-- Grants non-admin users the ability to import and export data (Sites, Inventory, System Keys, Vendors).

IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'ImportExport')
  INSERT INTO Roles (RoleName, Description)
  VALUES ('ImportExport', 'Can import and export data for Sites, Inventory, System Keys, and Vendors');
