# OUCU Contact Center — Render with Webex SSO

The existing OUCU dashboard design includes queue health, call-volume charts, agent status and FCR. Metrics remain labeled sample data. OAuth reporting authorization and a reporting access check are included; actual KPI mapping follows verification of OUCU responses.

## Deploy or update

1. Upload this folder's contents to your private GitHub repository at the root, replacing the earlier Render package.
2. Deploy using Render New → Blueprint, or let your existing service redeploy from the updated repository. Runtime Node 22; build `npm run build`; start `npm start`; health check `/health`.
3. Set WEBEX_CLIENT_SECRET to the Integration's secret.
4. Set WEBEX_ADMIN_EMAILS to your administrator account email **inside OUCU's organization**. Multiple dashboard administrators can be listed separated by commas. This allowlist controls who can connect reporting, not who can view the dashboard.
5. Keep APP_SECRET unchanged on updates. New Blueprint deployments generate it automatically. Existing manually configured services need a long random APP_SECRET. Keep DATA_DIR=/var/data and a persistent disk mounted at /var/data. The Blueprint specifies a paid starter service with a 1 GB disk; review cost in Render before deployment.
6. Remove DASHBOARD_USER and DASHBOARD_PASSWORD. APP_ORIGIN is optional; remove it to automatically use Render's RENDER_EXTERNAL_URL. A custom domain can use an explicit APP_ORIGIN override. Do not use a stale URL.
7. Update your Webex Integration:
   - Add scope `spark:people_read` for dashboard sign-in.
   - Keep scope `cjp:config_read` for reporting.
   - Add BOTH exact redirect URIs, substituting your actual service URL:
     - https://YOUR-SERVICE.onrender.com/auth/webex/callback
     - https://YOUR-SERVICE.onrender.com/oauth/webex/callback
8. Open the Render URL and click Sign in with Webex. Sign in using an account in OUCU's organization. Other organizations are rejected.
9. As a configured administrator, click Connect Webex → Authorize Webex, then Check reporting access. This is a separate administrative reporting grant. Regular users sign in using only the identity scope.

## Configuration already included

WEBEX_CLIENT_ID=C982b913a8752b4dba22b10cb2e8866589ecf0e1c03b82fd0aab70cf91e19787a
WEBEX_ORG_ID=1e2592c2-b4f8-47cf-ac33-039d235962e4
WEBEX_API_BASE=https://api.wxcc-us1.cisco.com

Change WEBEX_API_BASE only if OUCU is provisioned in a different region.

## Authentication and data

Webex verifies identity using /people/me; the organization UUID is checked on the server. Signed, HttpOnly, Secure cookies last eight hours. OAuth state protects sign-in and authorization. Sign out removes the local dashboard session; it does not sign out the user globally from Webex. Existing Webex sessions can complete sign-in without asking for credentials again.

All OUCU organization members can view the dashboard after Webex authentication. WEBEX_ADMIN_EMAILS limits reporting connection management. Add a separate viewer allowlist if access should later be limited to specific supervisors.

The administrative reporting tokens are AES-GCM encrypted on the persistent disk using APP_SECRET. Tokens refresh when a reporting check needs them and expiry is approaching. This version is not yet a background reporting poller. A reporting check requests only the first page of tasks in the last 24 hours; it is not a total call count.

Actual FCR must use OUCU's agreed resolution measure (wrap-up outcomes or repeat-contact logic). The displayed sample FCR must not be treated as a real measured result.

/health exposes only service status. All metrics, settings and reporting checks require sign-in. No secrets should be committed to GitHub. Existing credentials in the earlier hosted preview are not migrated; authorize reporting again on Render.

## Separate administrator access

Set ADMIN_ACCESS_PASSWORD in Render Environment to a unique password of at least 12 characters. Do not commit it to GitHub. Open https://YOUR-SERVICE.onrender.com/admin and enter that password. This signs in the trusted administrator directly, without requiring an OUCU Webex identity, and permits managing the reporting connection. Admin sessions last one hour.

Admin access is disabled when ADMIN_ACCESS_PASSWORD is missing or shorter than 12 characters. Webex remains the regular user sign-in and still restricts users to OUCU. The admin page is separate from the user login. Login requires same-origin CSRF validation and rate-limits incorrect passwords to five attempts per 15-minute window; limits reset when the process restarts and may be shared by clients behind Render's proxy. Removing the admin password disables new admin logins; existing sessions last until expiry or APP_SECRET rotation.
