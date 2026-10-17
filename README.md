# Velvet Seat Cinema – React + Supabase (with login, Google Authenticator 2FA and admin)

## One-time Supabase setup
1. Supabase project > **SQL Editor** > paste and run `supabase/schema.sql` (it resets the tables first).
2. **Authentication > Providers > Email**: turn **Confirm email** OFF (easier for testing).
3. **Authentication > Multi Factor** (or Sign In / Providers > MFA): make sure **TOTP** is enabled (it is by default).
4. Copy `.env.example` to `.env` and add your Project URL and anon/publishable key.

## Run
`npm install` then `npm run dev`

## First login and making yourself admin
1. Open the app, **Create account**, then scan the QR code with **Google Authenticator** and enter the code.
2. In the SQL Editor run: `update profiles set role = 'admin' where email = 'you@example.com';`
3. Sign out and log in again (enter a new code). An **Admin** link now appears in the header.

Every login asks for a fresh 6-digit code. See `DOCS.md` for the data structures and algorithms.
