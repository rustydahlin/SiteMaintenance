'use strict';

const ROLES = {
  ADMIN:       'Admin',
  TECHNICIAN:  'Technician',
  CONTRACTOR:  'Contractor',
  VIEWER:      'Viewer',
};

const AUTH_PROVIDERS = {
  LOCAL: 'local',
  OIDC:  'oidc',
  LDAP:  'ldap',
};

const INVENTORY_STATUSES = {
  IN_STOCK:    'In-Stock',
  DEPLOYED:    'Deployed',
  IN_REPAIR:   'In-Repair',
  CHECKED_OUT: 'Checked-Out',
  RETIRED:     'Retired',
};

const REPAIR_STATUSES = {
  SENT:                 'Sent',
  FOLLOWUP_PENDING:     'FollowUp-Pending',
  RECEIVED:             'Received',
  RETURNED_TO_INVENTORY:'Returned-to-Inventory',
  RETIRED:              'Retired',
};

const LOG_TYPES = {
  PREVENTIVE_MAINTENANCE: 'Preventive Maintenance',
  CORRECTIVE_MAINTENANCE: 'Corrective Maintenance',
  CONTRACTOR_WORK:        'Contractor Work',
  TECHNICIAN_WORK:        'Technician Work',
  GENERAL_NOTE:           'General Note',
  SITE_INSPECTION:        'Site Inspection',
  INVENTORY_CHANGE:       'Inventory Change',
};

const SITE_STATUSES = {
  ACTIVE:          'Active',
  OFFLINE:         'Offline',
  MAINTENANCE:     'Maintenance',
  DECOMMISSIONED:  'Decommissioned',
};

module.exports = {
  ROLES,
  AUTH_PROVIDERS,
  INVENTORY_STATUSES,
  REPAIR_STATUSES,
  LOG_TYPES,
  SITE_STATUSES,
};
