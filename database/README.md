# Database

## Initial Setup

Run `schema.sql` against an empty SQL Server 2016+ database before starting the app for the first time. This creates all tables, indexes, and constraints.

## Migrations

Migrations in `migrations/` apply incremental changes to an existing database. Run them in order by filename number. Each migration is idempotent (safe to re-run).

| File | Description |
|------|-------------|
| 001_initial.sql | Initial schema seed data (roles, default settings) |
| 002_bulk_inventory.sql | Bulk inventory tracking support |
| 003_inventory_stock.sql | Stock locations for bulk inventory |
| 004_settings_encryption.sql | Encrypted settings support |
| 005_site_parent.sql | Parent/child site hierarchy |
| 006_inventory_extended.sql | Extended inventory fields |
| 007_site_fields.sql | Additional site fields |
| 008_vendors.sql | Vendor/contractor management |
| 009_system_keys.sql | Physical/electronic key tracking |
| 010_user_notifications.sql | Per-user notification preferences |
| 011_repair_assigned_user.sql | Assigned user field on repairs |
| 012_repair_sentdate_nullable.sql | Make SentDate nullable for repairs |
| 013_inventory_picklists.sql | Inventory category/status picklists |
| 014_maintenance.sql | Maintenance items tracking |
| 015_email_templates.sql | Customizable email templates |
| 016_user_organization.sql | Organization field on users |
| 017_import_export_role.sql | ImportExport role |
| 018_vendor_documents.sql | Document attachments for vendors |
| 019_user_deleted.sql | Soft-delete support for users |
| 020_network_resources.sql | Network resources tracking |
| 021_network_map_updater_role.sql | NetworkMapUpdater role |
| 022_session_timeout.sql | Configurable session timeout setting |
| 023_push_subscriptions.sql | PWA push notification subscriptions |
| 024_reports.sql | Reports role and reports.enabled feature flag |

## PWA Push Notifications (Migration 023)

The `PushSubscriptions` table stores Web Push API subscriptions for PWA users. Subscriptions are managed automatically when users enable notifications in the mobile app (`/mobile`). Expired or invalid subscriptions are pruned automatically during the daily cron job.

To enable push notifications, add VAPID keys to your `.env`:

```bash
# Generate keys once with:
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k)"
```

Then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_EMAIL` in `.env`.
