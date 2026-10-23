# Cookies and storage: [COMMUNITY]

> ⚖️ Draft for legal review. Effective [EFFECTIVE_DATE]. Keep this list in sync with
> `apps/mobile/src/lib/storage-inventory.ts` (the privacy e2e test checks the browser against it).

We use **only what the service needs to work**, or what remembers a choice you made. There are no
analytics, advertising or third-party cookies, so we don't ask you to accept cookies. [If you add
analytics: it may run only after the member opts in to "anonymous usage statistics", and this page and
the inventory must list it.]

## Web app

| Name                                                                     | Type                                   | Purpose                                                                        | Duration                                                          |
| ------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `nexaheart.session_token` (on HTTPS: `__Secure-nexaheart.session_token`) | Cookie: HttpOnly, Secure, SameSite=Lax | Keeps you signed in                                                            | 30 days, renewed while you use the app; removed when you sign out |
| `nexaheart.locale`                                                       | Browser storage                        | Remembers the language you chose                                               | Until you change it                                               |
| `nexaheart.callNotice`                                                   | Browser storage                        | Remembers that you read the notice before your first call (video dates)        | Until changed                                                     |
| `nexaheart.display`                                                      | Browser storage                        | Text size, easy mode, contrast and motion you chose (never sent to the server) | Until changed                                                     |
| `nexaheart-admin-locale` (moderation dashboard only)                     | Browser storage                        | Language of the dashboard                                                      | Until changed                                                     |

## iPhone and Android apps

| Name                     | Where                       | Purpose                                                   | Duration                            |
| ------------------------ | --------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `nexaheart_cookie`       | Device keychain (encrypted) | Keeps you signed in                                       | 30 days, renewed while used         |
| `nexaheart_session_data` | Device keychain             | A copy of your session so the app opens quickly           | Until you sign out                  |
| `nexaheart.locale`       | Device keychain             | Your language                                             | Until changed                       |
| `nexaheart.pushToken`    | Device keychain             | Only if you turn on notifications                         | Until you sign out or turn them off |
| `nexaheart.callNotice`   | Device keychain             | Remembers that you read the notice before your first call | Until changed                       |
| `nexaheart.display`      | Device keychain             | Text size, easy mode, contrast and motion you chose       | Until changed                       |

## Your control

Signing out removes the session items. You can also delete them in your browser or device settings
(you'll then need to sign in again). The page "Privacy & cookies" in the app shows this list.
