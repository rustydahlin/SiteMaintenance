-- Migration 021: Add NetworkMapUpdater role
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'NetworkMapUpdater')
  INSERT INTO Roles (RoleName, Description)
  VALUES ('NetworkMapUpdater',
    'Can view sites and manage Network Resources (add/edit/delete devices and import/export network resources). Cannot delete sites or access other admin areas.');
