# Firebase authentication setup

## Firebase Console

Create a Firebase project and register a Web app. In **Authentication → Sign-in method**, enable **Email/Password**. Keep email verification enabled in the application flow. Configure the Firebase Authorized Domains for the domain where the React frontend will run.

Copy `client/config/firebase.env.sample` to a private frontend environment file and fill in the Web app values. Do not commit that file with real values.

## First user and roles

The first successful Firebase profile sync inserts a new user into MySQL as `staff`. This is intentional: registration never grants admin access. A super administrator must promote the user by updating `users.role_id` to the `admin` or `super_admin` role in MySQL, or through a future user-management screen.

```sql
USE medidispense;
UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'admin') WHERE email = 'admin@example.com';
```

Role behavior in the current UI is:

| Role | Access |
| --- | --- |
| `staff` | Dashboard and reports in read-only mode |
| `admin` | Medicine and inventory management plus operational views |
| `super_admin` | Full administrative access; use for role/account management |

The PHP API independently checks Firebase token validity and database role before protected mutations. Frontend visibility is not the security boundary.

## Authentication flow

The login screen supports email/password sign-in, staff registration, password reset, and verification-email resend. New registrations must verify their email before the admin dashboard is shown. On an authenticated session, the browser sends the Firebase ID token to `POST /api/auth/profile`; the PHP API verifies signature, issuer, audience, timestamps, and Firebase UID, then provisions or loads the MySQL profile. Logout signs out of Firebase and clears the local token mirror.

The customer kiosk remains public at `/kiosk`; the admin dashboard is protected when Firebase configuration is present.
