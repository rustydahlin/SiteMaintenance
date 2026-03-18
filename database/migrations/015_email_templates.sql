-- Migration 015: Email Templates
-- Inserts default email template bodies into AppSettings.
-- These are used by emailService.js and can be customized via Admin > Email Templates.

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.maintenance.assigned')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.maintenance.assigned',
    N'<h3>Maintenance Item Assigned to You</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{typeName}}</p>
<p><strong>Due:</strong> {{dueDate}}</p>
<p><strong>Reference #:</strong> {{reference}}</p>
<p><strong>Work to Complete:</strong><br/>{{workToComplete}}</p>
<p><a href="{{url}}">View Item</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.maintenance.reminder')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.maintenance.reminder',
    N'<h3>Maintenance Reminder</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{typeName}}</p>
<p><strong>Due:</strong> {{dueDate}} ({{daysUntilDue}})</p>
<p><strong>Reference #:</strong> {{reference}}</p>
<p><strong>Work to Complete:</strong><br/>{{workToComplete}}</p>
<p><a href="{{url}}">View Item</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.maintenance.overdue')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.maintenance.overdue',
    N'<h3>Maintenance Item Overdue</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{typeName}}</p>
<p><strong>Due Date:</strong> <span style="color:red">{{dueDate}} ({{daysOverdue}})</span></p>
<p><strong>Reference #:</strong> {{reference}}</p>
<p><a href="{{url}}">View Item</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.pm.reminder')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.pm.reminder',
    N'<h3>Preventive Maintenance Reminder</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Task:</strong> {{taskTitle}}</p>
<p><strong>Due:</strong> {{daysUntilDue}}</p>
<p><strong>Assigned To:</strong> {{assignedTo}}</p>
<p><a href="{{url}}">View Site</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.repair.overdue')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.repair.overdue',
    N'<h3>Repair Return Overdue</h3>
<p><strong>Item:</strong> {{serialNumber}} — {{modelNumber}}</p>
<p><strong>Expected Return:</strong> <span style="color:red">{{expectedReturn}}</span></p>
<p><strong>Days Since Sent:</strong> {{daysSinceSent}}</p>
<p><strong>Assigned To:</strong> {{assignedTo}}</p>
<p><a href="{{url}}">View Repair</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.repair.unsent')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.repair.unsent',
    N'<h3>Unsent RMA — Action Required</h3>
<p>The following repair/RMA was created but the item has not been shipped yet. Please ship the item and update the Sent Date to stop these reminders.</p>
<p><strong>Item:</strong> {{itemLabel}}</p>
<p><strong>RMA #:</strong> {{rmaNumber}}</p>
<p><strong>Manufacturer:</strong> {{manufacturer}}</p>
<p><strong>Created:</strong> {{daysSinceCreated}}</p>
<p><strong>Contact:</strong> {{contact}}</p>
<p><a href="{{url}}">View &amp; Update Repair</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.warranty.expiring')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.warranty.expiring',
    N'<h3>Warranty Expiring Soon</h3>
<p><strong>{{label}}</strong></p>
<p><strong>Expires:</strong> {{expiresDate}} ({{daysLeft}} day(s) remaining)</p>
<p><a href="{{url}}">View Details</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.systemKey.expiring')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.systemKey.expiring',
    N'<h3>System Key Expiring Soon</h3>
<p><strong>Issued To:</strong> {{issuedTo}} ({{organization}})</p>
<p><strong>Serial #:</strong> {{serialNumber}}</p>
<p><strong>Key Code:</strong> {{keyCode}}</p>
<p><strong>Expires:</strong> {{expiresDate}} ({{daysLeft}} day(s) remaining)</p>
<p><a href="{{url}}">View Key</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.log.new')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.log.new',
    N'<h3>New Log Entry</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Type:</strong> {{logType}}</p>
<p><strong>Subject:</strong> {{subject}}</p>
<p><strong>Date:</strong> {{date}}</p>
<p><a href="{{url}}">View Log Entry</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.welcome')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.welcome',
    N'<h3>Welcome, {{displayName}}!</h3>
<p>Your account has been created.</p>
<p><strong>Username:</strong> {{username}}</p>
<p><strong>Temporary Password:</strong> {{temporaryPassword}}<br/><em>Please change it after your first login.</em></p>
<p><a href="{{loginUrl}}">Log In</a></p>');

IF NOT EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey = 'emailTemplate.site.statusChange')
  INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('emailTemplate.site.statusChange',
    N'<h3>Site Status Change</h3>
<p><strong>Site:</strong> {{siteName}}</p>
<p><strong>Status:</strong> {{oldStatus}} → <strong>{{newStatus}}</strong></p>
<p><a href="{{url}}">View Site</a></p>');
