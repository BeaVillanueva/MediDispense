# MediDispense

MediDispense is a functional medicine-vending system for a capstone machine with two experiences: an **admin control center** and a **touch-friendly customer kiosk**. The application includes a normalized MySQL schema, a PHP REST API for XAMPP, Firebase-authentication integration hooks, a React/Vite preview application, and an ESP32 hardware contract.

## Delivered architecture

The React application in `client/` is the interactive admin dashboard and kiosk. The preview server uses typed tRPC procedures and a domain service so the application is usable immediately without a local database. The XAMPP deployment path is in `backend/` and uses the normalized `database/schema.sql` schema. The PHP API is the production source of truth for MySQL inventory, transactions, payments, dispensing requests, sensor verification, audit logs, notifications, and CSV exports.

The machine model is slot-driven rather than medicine-column-driven. The current seed uses three rows in `machine_slots`, and adding Slot 4 is an insert plus a motor/sensor mapping; no table redesign is required.

For the current machine, the kiosk intentionally exposes only medicines assigned to Slots 1–3. Other catalog records may exist for inventory planning, but they are not purchasable until an administrator assigns them to a machine slot.

## Run the React application in this environment

```bash
cd /home/ubuntu/medidispense
pnpm install
pnpm dev
```

Open the preview root for the admin dashboard. Open `/kiosk` for the customer screen. The dashboard includes live refresh intervals, inventory adjustments, medicine creation, CSV download, machine status, and a complete demo kiosk flow.

The preview data service is intentionally in-memory so the UI can be exercised without exposing or hard-coding real stock. When deploying against XAMPP, point the frontend API client at the PHP API or replace the preview procedures with `fetch` calls to the documented endpoints.

## Run PHP/MySQL using XAMPP

1. Install XAMPP with PHP 8.1+ and MySQL/MariaDB. Start Apache and MySQL from the XAMPP control panel.
2. Copy this repository into `C:/xampp/htdocs/medidispense` on Windows, or `/opt/lampp/htdocs/medidispense` on Linux.
3. Open phpMyAdmin and import `database/schema.sql`. The script creates the `medidispense` database, all foreign keys and indexes, default roles, categories, one machine, three slots, and system settings.
4. Install the PHP dependency:

   ```bash
   cd backend
   composer install
   ```

   This installs `firebase/php-jwt` for Firebase ID-token signature verification.

5. Copy `backend/config/env.sample` to a private environment file or configure the same variables in Apache/PHP-FPM. Do not commit Firebase or hardware secrets. Required values are:

   | Variable | Purpose |
   | --- | --- |
   | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection |
   | `FIREBASE_PROJECT_ID` | Firebase project used for ID-token audience/issuer validation |
   | `FIREBASE_INITIAL_SUPER_ADMIN_EMAIL` | Verified Firebase email permitted to claim the initial owner role during first-time provisioning |
   | `HARDWARE_API_KEY` | Secret sent by ESP32 in `X-Hardware-Key` |
   | `CORS_ORIGINS` | Allowed React origins |

6. Verify the health endpoint:

   ```text
   http://localhost/medidispense/backend/public/api/health
   ```

   If Apache does not rewrite extensionless paths, enable `mod_rewrite` and allow overrides for the backend directory. The provided `backend/public/.htaccess` routes requests to `index.php`.

## Firebase Authentication

Create a Firebase Web application and enable email/password authentication, email verification, password reset, and the Firebase client SDK in the React deployment. The PHP API must receive the Firebase ID token as:

```http
Authorization: Bearer <firebase-id-token>
```

The API validates the token signature against Google Secure Token certificates, then checks `aud`, `iss`, `sub`, `iat`, and `exp`. The MySQL `users` table stores `firebase_uid`, profile fields, and the server-controlled role. There is no PHP password store. Roles are exactly `super_admin`, `admin`, and `staff`; permissions are enforced by the PHP API on every protected request.

Set `FIREBASE_INITIAL_SUPER_ADMIN_EMAIL` to the verified owner email before first sign-in. The first matching Firebase account is provisioned as `super_admin`; other new registrations receive `staff`. On an existing database, apply `database/migrations/2026_09_24_employee_rbac.sql` to normalize employee roles, then apply `database/migrations/2026_09_25_employee_profile.sql` to add permanent generated Employee IDs. The existing `users.profile_image_url` field is reused for profile photos.

The Node/tRPC server must also have `MEDIDISPENSE_PHP_API_URL` set to the PHP API base URL (the same value as `VITE_API_BASE_URL`). It verifies each Firebase bearer token through the PHP profile endpoint before serving employee dashboard procedures. Production dashboard procedures fail closed if this bridge is not configured.

## Employee role boundaries

| Capability | SUPER ADMIN | ADMIN | STAFF |
| --- | --- | --- | --- |
| Dashboard, medicine/stock, transactions, machine status | Full access | View and manage medicines/stock; view operations | Monitoring and read-only operations |
| Reports and inventory CSV | Yes | Yes | No |
| Employee roles, activity logs, system settings | Yes | No | No |
| Archive or change medicine records | Yes | Yes | No |
| Password reset | May send a Firebase reset email | Self-service only | Self-service only |

Employee identity/password creation remains in Firebase Authentication; the employee screen links the Firebase UID to the server-side role profile. Passwords are never stored in MediDispense.

## API structure

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/profile` | Verify Firebase token, provision/load profile, and start PHP session |
| `POST` | `/api/auth/logout` | Destroy the PHP session and clear the server-side session cookie |
| `GET` | `/api/medicines?available=1` | Vending-eligible medicines |
| `POST` | `/api/medicines` | Create medicine with admin-provided dosage copy |
| `PATCH` | `/api/inventory/adjust` | Add or adjust stock and log the movement |
| `GET` | `/api/dashboard/summary` | Metrics for the admin dashboard |
| `POST` | `/api/transactions/checkout` | Revalidate stock and create a payment-pending transaction |
| `POST` | `/api/payments/verify` | Verify amount, mark payment successful, and queue dispensing |
| `POST` | `/api/dispense/{id}` | Send a queued command to the ESP32 |
| `POST` | `/api/dispense/{id}/sensor` | Hardware callback for sensor confirmation |
| `POST` | `/api/machine/heartbeat` | ESP32 status heartbeat |
| `GET` | `/api/machine/status` | Machine and slot state |
| `GET` | `/api/transactions` | Admin transaction ledger |
| `GET` | `/api/notifications` | Stock, expiry, payment, and dispensing alerts |
| `GET` | `/api/logs` | Audit log |
| `GET` | `/api/reports/inventory.csv` | Inventory CSV export |

Hardware endpoints require `X-Hardware-Key`. Admin endpoints require a Firebase ID token and a role in the database. Authorization is enforced server-side, not only by React route visibility.

## Production authentication

The production frontend includes Firebase email/password sign-in, staff registration, email verification, password reset, protected admin routing, and Firebase-to-PHP profile/session synchronization. Configure the variables in `client/config/firebase.env.sample` and follow `docs/FIREBASE_AUTH_SETUP.md`. New registrations are provisioned as `staff`; a super administrator must promote users to `admin` or `super_admin`.

## Critical dispensing invariant

The payment endpoint **never deducts inventory**. It verifies payment and creates a `dispensing_requests` record. Only `POST /api/dispense/{id}/sensor` with `{ "success": true }` performs the row-locked inventory deduction, writes a `stock_movements` record, marks the request and transaction as dispensed, and makes the e-receipt eligible. A failed or timed-out sensor report writes a dispensing log and notification but leaves quantity unchanged.

## ESP32 contract

`esp32/medidispense_controller.ino` shows the expected heartbeat payload, hardware key, four motor/sensor pin slots, and the sensor confirmation callback. The firmware must report success only after the IR sensor or limit switch confirms an item crossed the chute. Slot 4 is already represented in the pin arrays as an expansion reserve.

## Medical safety

The system never generates dosage advice. `dosage_information` and `usage_instructions` are entered by an authorized administrator and rendered as stored. The kiosk displays the label-reading and pharmacist/healthcare-professional disclaimer before purchase.

## Validation commands

```bash
pnpm check
pnpm test
pnpm build
php -l backend/public/index.php
php -l backend/src/Database.php
php -l backend/src/Http/Response.php
php -l backend/src/Auth/FirebaseTokenVerifier.php
```
