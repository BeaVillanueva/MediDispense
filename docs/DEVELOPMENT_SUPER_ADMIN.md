# One development Super Admin

The existing Firebase Authentication account owns the password. MySQL `users` and
`roles` own authorization. This setup adds no password table, auth provider, public
bootstrap endpoint, or schema migration.

1. Start the existing MySQL/PHP services and frontend (`pnpm.cmd dev`). PHP uses
   `backend/config/config.php` and the ignored `backend/config/local.php` overrides.
   Use your development database and `app_env => development`. Do not overwrite
   existing local configuration. The sample env file is documentation, not an
   automatically loaded dotenv file.
2. In your existing Firebase project's Authentication user management, add an
   email/password user with an email you control and a strong unique password
   (or use your existing account). Set the password there, never in source, SQL,
   a shell command, or a React environment variable. Firebase manages password
   storage; this repository never stores the plaintext password. Existing users
   can use the login page's password-reset option.
3. Open the frontend URL shown by Vite at `/` and sign in. Use **Resend email**
   if needed, follow the verification email, then refresh/sign in again. PHP
   creates the normal staff profile and records verified email status from the
   signed Firebase token.
4. In PowerShell at the repository root, run (replace the example email):

   ```powershell
   C:\xampp\php\php.exe backend/src/Auth/bootstrap-super-admin.php --development you@example.com
   ```

5. Sign out and sign in again at `/`. PHP now returns the Super Admin role.

The CLI refuses non-development configuration, missing/unverified/inactive
employees, and any existing Super Admin (even inactive). Concurrent bootstrap
commands serialize on the existing role row. Assignment and audit logging commit
together. Repeating the command cannot create a second Super Admin. Subsequent
employee management remains the existing Super Admin-only workflow.

PHP continues to validate signed Firebase tokens and read permissions from MySQL
on protected requests. Super Admin access additionally requires a verified-email
token. Email matching never replaces an existing Firebase UID. The old
`FIREBASE_INITIAL_SUPER_ADMIN_EMAIL` automatic promotion setting is retired.

No SQL or migration is needed for this feature when the existing users/roles and
activity_logs tables are present. Do not reimport schema.sql into an existing
database: it drops tables. If MySQL cannot start, recover the existing database
first; this command does not repair, reset, or recreate it.
