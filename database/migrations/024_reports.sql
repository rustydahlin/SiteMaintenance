-- Migration 024: Reports role and feature flag
-- Adds the Reports role and the reports.enabled AppSetting.

IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Reports')
  INSERT INTO Roles (RoleName, Description)
  VALUES ('Reports', 'Can access the Reports section to run and print reports.');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'reports.enabled')
  INSERT INTO AppSettings (SettingKey, SettingValue)
  VALUES ('reports.enabled', '0');
