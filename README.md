# OUCU Contact Center — Render with Webex SSO

The existing OUCU dashboard design includes queue health, call-volume charts, agent status and FCR. Metrics remain labeled sample data. OAuth reporting authorization and a reporting access check are included; actual KPI mapping follows verification of OUCU responses.

## Deploy or update

1. Upload this folder's contents to your private GitHub repository at the root, replacing the earlier Render package.
2. Deploy using Render New → Blueprint, or let your existing service redeploy from the updated repository. Runtime Node 22; build `npm run build`; start `npm start`; health check `/health`.
3. Set WEBEX_CLIENT_SECRET to the Integration's secret.
4. Set WEBEX_ADMIN_EMAILS to your administrator account email **inside OUCU's organization**. Multiple dashboard administrators can be listed separated by commas. This allowlist controls who can connect reporting, not who can view the dashboard.
5. Keep APP_SECRET unchanged on updates. New Blueprint deployments generate it automatically. Existing manually configured services need a long random APP_SECRET. Keep DATA_DIR=/var/data and a persistent disk mounted at /var/data. The Blueprint specifies a paid starter service with a 1 GB disk; review cost in Render before deployment.
6. Remove DASHBOARD_USER and DASHBOARD_PASSWORD. Set APP_ORIGIN to https://oucudashboard.bullfrog.net. This custom domain is also the application default; an old https://oucu-contact-center.onrender.com override is migrated to the new domain. Keep RENDER_EXTERNAL_URL as Render provides it.
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


## Dashboard views and metric rules (October 14, 2026)
- Senior Management: daily, Monday-based weekly, and monthly inbound voice trends for the selected Eastern date range. Partial weeks/months contain only selected dates.
- Manager: inbound arrival volume by weekday/hour heat map and operational queue detail.
- Call Center Agents: reported parked contacts, connected contacts, Available agents, current exact idle code, today's idle/call activity totals, team activity summary, and longest current/period queue waits.
- OUCU Agent Details is intentionally omitted pending the customer's report configuration.
- Handled remains the Webex isContactHandled flag, including answered transfers and active contacts.
- Pre-queue exit percentage: completed, unhandled customer-left contacts without queue-contact/queued activity or reported queue entry, excluding TransferToDN, divided by all inbound contacts.
- Post-entry abandonment percentage: unhandled terminationType abandoned contacts with queue entry, divided by all queued/presented contacts. The two percentages have different denominators.
- Average queue wait: average queueDuration for inbound queued contacts whose reported status is connected or ended, as supplied by the customer. Missing values show Unavailable.
- Service level: answered queued contacts with total queueDuration <= 15 seconds divided by all presented queued contacts. This differs from the previous completed-contact denominator.
- Currently in queue: active telephony contacts with reported status parked and queue metadata.
- Calls active: active telephony contacts with reported status connected.
- Current longest wait: time since the active queued activity began; incomplete activity history or missing timestamps show Unavailable. This is not contact creation/IVR time.
- Longest selected-period wait: maximum reported total queueDuration across queued inbound contacts.
- Agent daily idle: voice idle intervals clipped at Eastern midnight, with Available excluded; overlapping call intervals removed. Exact idle-code totals are displayed.
- Agent daily call time: union of connected, hold, consultation, conference and equivalent outbound voice intervals, clipped at Eastern midnight. Wrap-up and ringing are excluded. Overlapping activities count once.
- Agent history requests paginate sessions and inner activities. Incomplete or invalid history yields Unavailable, not a partial total. Session discovery uses a seven-day lookback; sessions outside this reporting window are not reconstructed.
- Reported queue/team state refreshes every 15 seconds; KPIs and daily activity refresh every 60 seconds and may lag Webex. Historical date mode hides current state and daily agent totals. There is no streaming/websocket feed.


## Separate report access
Report URLs:
- /reports/senior — Senior Management
- /reports/manager — Manager
- /reports/agent — Call Center Agents

Set these Render environment variables to comma-separated exact Webex sign-in email addresses:
- SENIOR_DASHBOARD_EMAILS
- MANAGER_DASHBOARD_EMAILS
- AGENT_DASHBOARD_EMAILS

A user can appear in more than one list. Lists are case-insensitive; wildcards are not accepted. Unassigned org members receive no report access. WEBEX_ADMIN_EMAILS and the backup local administrator retain access to all reports. Empty lists grant no ordinary users access; set the user lists before handing the links to staff.

The root URL lists only assigned reports and redirects users with one assignment directly to their report. Sign-in still verifies OUCU organization membership. Report-scoped API routes enforce the same permissions; legacy aggregate/operational API routes are admin-only. Senior responses omit operational details; Manager cannot request current callers or agent-history APIs.


## Personal agent statistics
The Agent Dashboard has separate side-by-side My Agent Statistics and Team Statistics panels (stacked on narrow screens). Its agent-history API filters individual data using the verified Webex session email and the Search API agentSession userLoginId. User-supplied query parameters, display names and report selectors do not choose an agent. Filtering occurs after the shared reporting cache is read, without changing that cache.
Only one exact case-insensitive login match is accepted. Unmatched or ambiguous identities receive no individual records. Backup password administration has no agent identity and must use Webex sign-in to see personal statistics. Team daily totals are aggregated server-side before individual filtering; teammate names, login IDs and individual idle-code totals are not included in that personal-history response. Current team status remains available in the separate team status panel.


## Today-only live wait timers
Today-only mode polls current queued contacts and team status every 15 seconds, using matching shared server cache windows and request coalescing. Webex 429 responses impose a Retry-After backoff of at least 60 seconds. KPIs and daily personal/team duration totals retain 60-second polling.
Each queued caller's wait timer advances every second using the reported queue wait plus server-measured report age and monotonic browser elapsed time. Contact/IVR creation time is never substituted for a missing queue-entry timestamp. Timers pause after report age exceeds 60 seconds; failed reporting clears current counts and timers. Current longest wait advances with these timers. Historical mode hides the live queue/status boxes and stops those requests.
This is polling with local timer interpolation, not a streaming Webex event feed.


## OUCU Agent Details in Manager Dashboard
The Manager report embeds Cisco Analyzer visualization 43782 for the OUCU org at the bottom of the Manager Dashboard. The iframe is initialized only on the authorized /reports/manager route. Cisco authentication and Analyzer report permissions remain enforced by Cisco; no dashboard tokens or admin credentials are forwarded to the iframe.
The report uses its own Analyzer date/filter controls; the dashboard From/To controls do not change it. Open in Analyzer and Reload report controls support signing in outside the frame. Frame loading depends on Cisco's browser/security policies and the user's Analyzer session.


## Manager agent occupancy
Manager-only `/api/reports/manager/occupancy` queries fully paginated Webex Search agentSession records with telephony channel totals. The exact OUCU formula is `(availableDuration + connectedDuration + wrapupDuration + outdialConnectedDuration + outdialWrapupDuration) / (MAX(endTime) - MIN(startTime)) * 100`, grouped by agent across the selected Eastern date range. All five native durations and timestamps are milliseconds. Gaps between sessions remain in the denominator; percentages are not clamped.
The table shows each component and first login / last logout. When the selected range ends today and Webex reports isActive=true, the report timestamp replaces the last logout as spanEnd and the percentage is labeled Live. Closed sessions use the maximum recorded logout. An unconfirmed logout without an active-session flag, missing duration, invalid timestamps, or session crossing the selected boundaries makes the percentage unavailable; no prorated total is substituted. Native session totals displayed for a crossing session are accompanied by this warning. Today mode refreshes every 60 seconds; historical dates use Apply dates or Refresh. Responses are shared for 60 seconds, concurrent requests are coalesced, and 429 responses impose backoff. Agent and Senior routes cannot access this endpoint; legacy access requires administrator authentication. Personal agent active-time calculations remain separate.

## Custom domain
Canonical dashboard origin: https://oucudashboard.bullfrog.net. All three report paths remain /reports/senior, /reports/manager, and /reports/agent. Admin access remains /admin. Relative report links use the current domain. New host-only sessions require a fresh sign-in after moving domains.
Register both exact redirect URIs in the existing Webex Integration:
- https://oucudashboard.bullfrog.net/auth/webex/callback (dashboard Webex SSO)
- https://oucudashboard.bullfrog.net/oauth/webex/callback (administrator reporting authorization)
The server uses the canonical custom domain for OAuth authorization and token exchange and permits form submissions from it. The Render service URL remains an allowed origin for existing deployments; reporting tokens and organization/report access lists are unchanged. Future APP_ORIGIN overrides still work, except the retired Render-domain value maps to the canonical custom domain.
