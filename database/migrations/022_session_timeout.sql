-- Migration 022: Add session.timeoutHours AppSetting (default 8 hours)

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'session.timeoutHours')
  INSERT INTO AppSettings (SettingKey, SettingValue, IsEncrypted, Description)
  VALUES (
    'session.timeoutHours',
    '8',
    0,
    'How long user sessions remain active (in hours). Requires server restart to take effect. Default: 8.'
  );
