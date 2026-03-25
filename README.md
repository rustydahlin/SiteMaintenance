# SiteMaintenance

A generic infrastructure site management web application for tracking sites, inventory, maintenance logs, repair/RMA records, and more. Built with Node.js, Express, EJS, and Microsoft SQL Server.

---

## Features

- **Sites** — Manage sites of configurable types and statuses with GPS coordinates, warranty tracking, and full history; Excel import/export
- **Inventory** — Track serialized and bulk equipment across stock locations and site deployments; Excel import/export
- **Log Entries** — Preventive maintenance, corrective work, contractor/technician notes, auto-generated inventory change logs
- **Repair / RMA Tracking** — Track items sent for repair with follow-up and expected return dates; email reminders when overdue
- **PM Schedules** — Recurring preventive maintenance schedules with configurable frequencies, user/vendor assignment, and email reminders
- **Vendors / Contractors** — Manage external vendors with contacts, PM work enablement, and per-contact email opt-in for PM reminders
- **System Keys** — Track physical/electronic access keys issued to system users or vendor contacts; expiration tracking, renewal workflow, and email reminders to the key holder
- **File Attachments** — Upload photos and documents attached to log entries, sites, or inventory items; stored in database
- **User Management** — Four roles: Admin, Technician, Contractor, Viewer
- **Authentication** — Local accounts, Entra ID / OIDC, and LDAP / Active Directory
- **Email Notifications** — Configurable SMTP with reminders for PMs (including vendor/contact recipients), warranties, and repairs
- **Audit Log** — Full record of every user action with before/after values; filterable and exportable to Excel
- **System Logs** — Rotating file-based application logs via Winston; browseable and downloadable from the Admin panel; configurable retention

---

## Prerequisites

Before installing, ensure you have:

1. **Node.js** v18 or later — [nodejs.org](https://nodejs.org/)
2. **npm** (included with Node.js)
3. **Microsoft SQL Server** 2016 or later (Express edition is fine for small deployments)
   - SQL Server Management Studio (SSMS) or Azure Data Studio recommended for running scripts
4. **Git** (optional, for cloning)

---

## Installation

### Step 1 — Get the code

Clone the repository or download and extract the ZIP:

```bash
git clone https://github.com/yourorg/SiteMaintenance.git
cd SiteMaintenance
```

---

### Step 2 — Create the SQL Server database

1. Open SQL Server Management Studio (SSMS) and connect to your SQL Server instance.
2. Create a new empty database:
   ```sql
   CREATE DATABASE SiteMaintenance;
   ```
3. Select the `SiteMaintenance` database and open a new query window.
4. Open and run `database/schema.sql` — this creates all tables, indexes, and constraints.
5. Open and run `database/seed.sql` — this inserts default roles, statuses, log types, and the initial admin user.

> **Default admin credentials** (change these immediately after first login):
> - Username: `admin`
> - Password: `Admin@1234`

---

### Step 3 — Configure environment variables

1. Navigate to the `src/` folder.
2. Copy `.env.example` to `.env`:
   ```bash
   cd src
   cp .env.example .env      # Linux/macOS
   copy .env.example .env    # Windows
   ```
3. Open `src/.env` in a text editor and fill in the required values:

   **Required — Database:**
   ```
   DB_SERVER=localhost          # Your SQL Server hostname or IP
   DB_DATABASE=SiteMaintenance  # Database name created in Step 2
   DB_USER=sa                   # SQL Server login username
   DB_PASSWORD=your-password    # SQL Server login password
   DB_PORT=1433                 # Default SQL Server port
   DB_ENCRYPT=false             # Set to true for Azure SQL or TLS connections
   DB_TRUST_SERVER_CERT=true    # Set to false in production with valid certs
   ```

   **Required — Session & Encryption:**
   ```
   SESSION_SECRET=replace-with-a-long-random-string
   SETTINGS_ENCRYPTION_KEY=replace-with-another-long-random-string
   COOKIE_SECURE=false
   ```
   Generate strong secrets (run twice — once for each key):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```

   > **`SETTINGS_ENCRYPTION_KEY`** — Used to encrypt sensitive settings stored in the database (LDAP bind password, OIDC client secret, SMTP password). If not set, `SESSION_SECRET` is used as a fallback. **Warning:** changing this key invalidates previously encrypted settings — you will need to re-enter them in Admin → Settings.

   > **`COOKIE_SECURE`** — Set to `true` only when the app is behind HTTPS. Leave `false` for plain HTTP. Setting this to `true` over HTTP will silently break login (browser will not send secure cookies over HTTP).

   **Optional — OIDC / Entra ID:** (can also be configured in the Admin UI after setup)
   ```
   OIDC_CLIENT_ID=
   OIDC_CLIENT_SECRET=
   OIDC_TENANT_ID=
   OIDC_REDIRECT_URI=https://yourapp.example.com/auth/oidc/callback
   ```

   **Optional — LDAP / Active Directory:** (can also be configured in the Admin UI after setup)
   ```
   LDAP_URL=ldap://dc.example.com:389
   LDAP_BIND_DN=CN=svc-app,OU=ServiceAccounts,DC=example,DC=com
   LDAP_BIND_CREDENTIALS=service-account-password
   LDAP_SEARCH_BASE=OU=Users,DC=example,DC=com
   LDAP_SEARCH_FILTER=(sAMAccountName={{username}})
   ```

   **Optional — Email / SMTP:** (can also be configured in the Admin UI after setup)
   ```
   EMAIL_HOST=smtp.office365.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=notifications@example.com
   EMAIL_PASSWORD=smtp-password
   EMAIL_FROM_ADDRESS=notifications@example.com
   EMAIL_FROM_NAME=SiteMaintenance
   ```

> **Note:** OIDC, LDAP, and Email settings can all be left blank in `.env` and configured later through the **Admin → Settings** page in the web UI. The `.env` values serve as bootstrap/fallback defaults.

---

### Step 4 — Install Node.js dependencies

```bash
cd src
npm install
```

This installs all packages listed in `src/package.json`.

---

### Step 5 — Create the logs directory

The application writes log files to `src/logs/` by default:

```bash
mkdir src/logs     # Linux/macOS
md src\logs        # Windows
```

> The logs directory is git-ignored and will not be committed.

---

### Step 6 — Start the application

**Development** (auto-restarts on file changes):
```bash
cd src
npm run dev
```

**Production:**
```bash
cd src
npm start
```

The application will start on the port specified in `.env` (default: `3000`).

Open your browser to: **http://localhost:3000**

---

### Step 7 — First login and initial setup

1. Navigate to http://localhost:3000 and log in with:
   - Username: `admin`
   - Password: `Admin@1234`

2. **Change the admin password immediately:**
   - Go to **Profile** (top-right menu) → **Change Password**

3. **Configure settings** (Admin → Settings):
   - Set up OIDC / Entra ID if using Azure AD authentication
   - Set up LDAP / Active Directory if using AD authentication
   - Configure SMTP email settings for notifications

4. **Configure lookup values** (Admin → Administration):
   - Add **Site Types** appropriate for your environment
   - Add **Inventory Categories** for your equipment types
   - Add **Stock Locations** for your storage areas
   - Add **Monitoring Location Types**, **Network Device Types**, and **Circuit Types** if using the tower map integration

5. **Create users** (Admin → Users):
   - Create accounts for your team members
   - Assign appropriate roles (Admin, Technician, Contractor, or Viewer)

6. **Add sites and inventory** and begin tracking!

---

## Running in Production

For production deployments:

1. **Reverse proxy** — Place Nginx or IIS in front of Node.js
2. **Process manager** — Use PM2 to manage the Node.js process:
   ```bash
   npm install -g pm2
   cd src
   pm2 start server.js --name sitemaintenance
   pm2 save
   pm2 startup
   ```
3. **Environment** — Set `NODE_ENV=production` in `.env`
4. **HTTPS** — Configure TLS on your reverse proxy and set `DB_ENCRYPT=true`
5. **Session cookie** — Set `COOKIE_SECURE=true` in `.env` once HTTPS is in place. Do not set this over plain HTTP or login will silently break.

---

## Upgrading

When new database migrations are released:

1. Back up your database
2. Run the migration scripts in `database/migrations/` in order
3. Pull the latest code and restart the application

### Migration history

| File | Description |
|------|-------------|
| `002_bulk_inventory.sql` | Adds `TrackingType` and `QuantityTotal` to Inventory; adds `Quantity` to SiteInventory |
| `003_inventory_stock.sql` | Creates `InventoryStock` table for bulk quantity tracking; adds `PulledFromUserID` to SiteInventory |
| `004_settings_encryption.sql` | Adds `IsEncrypted` column to AppSettings for encrypted sensitive values |
| `005_site_parent.sql` | Adds `ParentSiteID` to Sites for parent/child (simulcast) site hierarchy |
| `006_inventory_extended.sql` | Adds `PartNumber`, `CommonName`, and `RelatedSystemID` to Inventory |
| `007_site_fields.sql` | Adds `SiteNumber` and `ContractNumber` to Sites |
| `008_vendors.sql` | Creates `Vendors` and `VendorContacts` tables; adds `AssignedVendorID` to `PMSchedules` |
| `009_system_keys.sql` | Creates `KeyManufacturers` lookup and `SystemKeys` table; adds `SystemKeys` role |
| `010_user_notifications.sql` | Creates `UserNotifications` table for per-user email notification opt-in preferences |
| `011_repair_assigned_user.sql` | Adds `AssignedUserID` to `RepairTracking`; back-fills from `SentByUserID` |
| `012_repair_sentdate_nullable.sql` | Makes `SentDate` nullable on `RepairTracking` so RMAs can be created before shipment |
| `013_inventory_picklists.sql` | Adds `InventoryCommonNames`, `InventoryModelNumbers`, `InventoryManufacturers` pick-list tables; seeds from existing data |
| `014_maintenance.sql` | Adds `MaintenanceTypes` and `MaintenanceItems` tables; replaces site statuses (Active/Offline/Decommissioned → Current/Past-Due); adds Maintenance and Maintenance-Close roles |
| `015_email_templates.sql` | Inserts default email template bodies into `AppSettings` for all 12 notification types |
| `016_user_organization.sql` | Adds `Organization` column to `Users` table for displaying user's organization on System Keys list |
| `017_import_export_role.sql` | Adds `ImportExport` role — grants non-admin users the ability to import and export data |
| `018_vendor_documents.sql` | Adds document attachment support for Vendors; adds `VendorID` foreign key option to `Documents` table |
| `019_user_deleted.sql` | Adds `DeletedAt` column to `Users` for soft-delete with name preservation |
| `020_network_resources.sql` | Adds `MonitoringLocationTypes`, `NetworkDeviceTypes`, `CircuitTypes` lookup tables; adds `MonitoringLocationTypeID` to `Sites`; creates `NetworkResources` table for tower map integration; seeds `towerMap.apiKey` AppSetting |

> **Note:** After running migration 020, set the `towerMap.apiKey` value in **Admin → Settings** before connecting SIRNnetworkmap. Generate a key with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

> **Note:** `database/schema.sql` always reflects the current full schema. Fresh installs only need to run `schema.sql` + `seed.sql` — migrations are only needed when upgrading an existing database.

---

## SIRNnetworkmap API Integration

SIRNnetworkmap can pull live site/device data from this app instead of a static `devices.json` file.

### 1. Generate and set the API key (SiteMaintenance)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output, then go to **Admin → Settings → Tower Map / SIRNnetworkmap** and paste it into the **API Key** field. Save.

### 2. Configure SIRNnetworkmap

In `SIRNnetworkmap/src/backend/.env`, add:

```env
SITEMAINT_API_URL=http://<host>:<port>/api/tower-map
SITEMAINT_API_KEY=<the key you generated above>
```

Replace `<host>` and `<port>` with the address where SiteMaintenance is running (e.g. `http://localhost:3000` during development, or your production hostname).

### 3. Verify the fallback chain

SIRNnetworkmap loads location data in this order:

| Tier | Source | When used |
|------|--------|-----------|
| 1 | SiteMaintenance API (`/api/tower-map`) | Normal operation |
| 2 | `devices.cache.json` | API unreachable; written after every successful API call |
| 3 | `devices.json` | Cache missing (first run before API ever succeeded) |
| 4 | Stale in-memory data | All files unavailable |

After the first successful API call, `devices.cache.json` is written and tier 3 is effectively never reached again.

### 4. Populate data in SiteMaintenance

For a site to appear on the tower map it needs both:
- **Monitoring Location Type** set on the site (Admin → Monitoring Location Types to manage options)
- At least one active **Network Resource** on the site's Network Resources tab

Use **Admin → Network Resources Import / Export** to bulk-import an existing `devices.json` or export the current database state back to that format.

### 5. Reverting to static devices.json (no API)

If you have trouble connecting to the API and need to add/remove locations and network devices:

1. Locate devices.cache.json in the src/frontend/overlays folder for SIRNnetworkmap
2. Delete the devices.cache.json file, and ensure a valid devices.json file is in that directory.

To stop using the API and return to a fully static setup:

1. In `SIRNnetworkmap/src/backend/.env`, remove (or comment out) both lines:
   ```env
   # SITEMAINT_API_URL=...
   # SITEMAINT_API_KEY=...
   ```
2. Ensure an up-to-date `devices.json` is in `SIRNnetworkmap/src/frontend/overlays/`. Use **Admin → Network Resources Import / Export → Export devices.json** to get a current copy from the database.
3. Restart SIRNnetworkmap. With both env vars absent, the API tier is skipped entirely and the static file is loaded directly.

---

## Directory Structure

```
SiteMaintenance/
├── database/
│   ├── schema.sql          # All table definitions — run first
│   ├── seed.sql            # Default data + initial admin user — run second
│   ├── wipe_test_data.sql  # Removes operational data before going to production
│   └── migrations/         # Incremental schema changes for existing installs
└── src/
    ├── server.js           # Entry point — run this
    ├── app.js              # Express app factory
    ├── package.json        # Dependencies
    ├── .env.example        # Environment template — copy to .env
    ├── config/             # Database, session, passport, constants
    ├── middleware/         # Auth, audit, error handling
    ├── models/             # Database query functions
    ├── routes/             # Express route handlers
    ├── views/              # EJS templates
    ├── public/             # Static assets (CSS, JS)
    ├── services/           # Email service
    ├── jobs/               # Background cron jobs
    ├── utils/              # Logger
    └── logs/               # Application log files (git-ignored)
```

---

## Troubleshooting

**Cannot connect to SQL Server**
- Verify `DB_SERVER`, `DB_USER`, `DB_PASSWORD` in `.env`
- Ensure SQL Server is running and TCP/IP is enabled in SQL Server Configuration Manager
- Check that port 1433 is not blocked by a firewall

**Session errors on startup**
- Ensure `schema.sql` was run and the `Sessions` table exists in your database

**Login not working / sign-in button appears to do nothing**
- Verify the `Users` table has the admin row from `seed.sql`
- Check that `COOKIE_SECURE` is not set to `true` while running over plain HTTP — this silently breaks sessions
- Check the application log in `src/logs/` for error details

**LDAP encrypted password lost after saving settings**
- Sensitive fields (LDAP bind password, OIDC secret, SMTP password) are skipped if left blank on save, preserving the stored value
- If a password appears as "Not set", re-enter and save it once to store it encrypted
- If you change `SETTINGS_ENCRYPTION_KEY`, all previously encrypted values must be re-entered

**OIDC callback errors**
- Ensure the `OIDC_REDIRECT_URI` exactly matches what is registered in your Entra ID app registration
- The redirect URI must be `https://` in production

**Email not sending**
- Verify SMTP settings in Admin → Settings or in `.env`
- Check the application log for SMTP error messages
