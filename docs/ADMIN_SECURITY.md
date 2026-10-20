# Admin login security

## Local setup

1. Back up your database, then apply the additive migration once (it is also safe
   to rerun):

   ```powershell
   C:\xampp\mysql\bin\mysql.exe -u root medidispense -e "SOURCE C:/xampp/htdocs/medidispense/database/migrations/2026_10_08_admin_security.sql"
   ```

   This adds only `admin_login_security`, keyed by normalized email hash, containing
   `failed_attempts`, `locked_until`, and `updated_at`. It changes no user records.
   Do not reimport schema.sql. The migration is not applied to your application DB
   automatically by this change.

2. Set `FIREBASE_WEB_API_KEY` in the PHP/Apache environment, or add `web_api_key`
   inside the existing `firebase` array in ignored `backend/config/local.php`.
   Use the existing project's Firebase Web API key (the public app identifier,
   not a service-account private key). Preserve its existing database_url and other
   configuration. This key must allow server-side Identity Toolkit requests;
   browser-referrer-only restrictions cannot authorize PHP calls. PHP does not
   automatically load the frontend .env.local. Never put account passwords here.
3. Restart the Node dev server and, if environment variables changed, Apache.
   Sign out and sign in again: pre-existing token-only admin sessions are rejected.
4. Use localhost consistently for both frontend and PHP so the HttpOnly SameSite
   cookie reaches both. Production deployment requires HTTPS and same-site origins;
   the cookie uses Secure when PHP is served over HTTPS.

## Enforcement

The login page sends credentials to PHP `/api/auth/login`. PHP serializes attempts
per normalized email and verifies credentials with the existing Firebase project's
[password sign-in REST API](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-email-password).
No password is stored or logged. After verification, PHP regenerates its session
ID and binds it to the verified Firebase UID. The frontend then uses its existing
Firebase SDK sign-in to maintain its Firebase user and tokens (two Firebase
password verifications on successful sign-in).

Five consecutive credential failures lock that email for 30 minutes. Unknown
emails have the same counters/messages as known emails. Locked attempts do not
contact Firebase or extend the deadline. Successful login clears failures; service
outages do not count as bad passwords. Expired locks are cleared and audited lazily
on the next authentication/security check. No password change is forced.

Admin/Super Admin PHP authorization now requires BOTH the verified Firebase token
and matching live PHP session. Direct Firebase sign-in or token refresh alone
cannot create/revive that session or bypass its lockout. The PHP role is authoritative.
Node/tRPC forwards the PHP cookie when checking roles and accessing PHP APIs.
Staff retain their existing token authorization and have no inactivity timeout;
the shared employee login form uses the same anti-enumeration attempt policy.

PHP expires admin authorization at 300 seconds since the last accepted activity.
Only the explicit activity endpoint extends it. Token/profile refreshes and dashboard
polling never extend it. Trusted click, pointer, touch, keyboard and navigation
events send throttled activity updates. A read-only session check coordinates
tabs, and the frontend clears Firebase auth on expiration with the requested
message. Reloading cannot reset the backend deadline. As with any web activity
signal, the server cannot prove physical human interaction; the deadline is still
enforced independently of the browser timer. Kiosk views do not send activity or
redirect to login and all public/hardware routes retain their existing behavior.

Employee Management displays Locked and offers Unlock Account only for Admin and Staff
targets. PHP independently requires a live Super Admin session and rejects self and Super Admin targets. Unlock clears the counter/deadline and audits the
acting and affected account. It does not grant or revive any session.

## Routes and audit

- New: POST `/api/auth/login`, GET `/api/auth/session`, POST `/api/auth/activity`,
  POST `/api/users/{id}/unlock`.
- Updated: auth/profile and every existing `$auth`-protected admin route enforce
  session expiry/lockout; GET users includes `is_locked` and `locked_until`.
- Existing logout destroys the PHP session; password-reset behavior is unchanged.
- Added audit events: `admin_login_success`, `admin_login_failed`, `account_locked`,
  `account_lockout_expired`, `admin_inactivity_logout`, `admin_account_unlocked`.
  Existing `user_logged_out` covers manual logout. No password/token/session ID is
  included in these events. Unknown accounts use a normalized email hash.

## Validation and acceptance

`php backend/tests/admin-security.php` uses only a disposable database on isolated
MySQL port 33317. It tests attempt counts, locking, automatic/manual unlock, audit
entries, server inactivity, activity renewal, missing sessions and staff exemption.
It injects a test password verifier; it never contacts Firebase or hardware.

Also run `pnpm.cmd check`, `pnpm.cmd test`, `pnpm.cmd build` and PHP syntax checks.
Before approving, test with a separate Admin account: fail five times, verify the
sixth/correct attempt is blocked, manually unlock as Super Admin, and log in. Check
30-minute automatic eligibility separately. Leave an admin dashboard idle for five
minutes while its polling continues, then try the old session/token against a
protected endpoint (must fail). Test active clicking/typing, reload, multiple tabs,
manual logout, staff access, and public kiosk use. Physical dispensing is not part
of these automated tests.
