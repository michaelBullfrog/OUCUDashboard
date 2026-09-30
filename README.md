# OUCU Contact Center — Render

OUCU supervisor dashboard with the existing logo, colors, queue health labels, FCR KPI, queue selector and fullscreen mode. All metrics and agents are still demonstration data. Webex OAuth and a reporting access check are included; live KPI and agent mappings are the next step after authorization is verified.

## Deploy

1. Create a private GitHub repository and upload the contents of this folder at its root.
2. In Render, select New → Blueprint and select the repository. The included render.yaml creates a Node web service with a 1 GB persistent disk. This requires a paid service; review Render's displayed cost before creating it.
3. Enter the prompted values:
   - APP_ORIGIN: the actual Render service URL, without a trailing slash (for example, https://YOUR-SERVICE.onrender.com). If the final URL differs, update this variable after deployment.
   - DASHBOARD_PASSWORD: a strong password you choose. Login username is oucu.
   - WEBEX_CLIENT_SECRET: the secret from your OUCU Webex Integration.
4. In the Webex Integration, add the exact redirect URI: YOUR_RENDER_URL/oauth/webex/callback. Keep cjp:config_read selected.
5. Open the Render URL, sign in as oucu using your chosen password, and click Connect Webex → Authorize Webex. Sign in with the administrator account inside OUCU's organization.
6. After returning, click Check reporting access. This queries the first page of task records in the last 24 hours. It does not claim to provide the full call count.
7. Report the result so queue, agent, and historical KPI fields can be mapped using the actual responses. FCR also needs OUCU's agreed resolution measure, such as its wrap-up outcome or repeat-contact rule.

## Manual web-service settings

- Runtime: Node
- Build: npm run build
- Start: npm start
- Health check: /health
- Disk mount: /var/data (1 GB)
- DATA_DIR: /var/data
- NODE_VERSION: 22
- DASHBOARD_USER: oucu
- APP_SECRET: a long randomly generated secret; keep it unchanged because it encrypts stored tokens.
- WEBEX_CLIENT_ID: already provided in render.yaml
- WEBEX_ORG_ID: already provided in render.yaml
- WEBEX_API_BASE: https://api.wxcc-us1.cisco.com (change if OUCU is provisioned in another region)
- APP_ORIGIN, DASHBOARD_PASSWORD, WEBEX_CLIENT_SECRET: enter in Render Environment.

## Security and storage

All dashboard and connection routes require HTTP Basic authentication; /health exposes only status. Do not put credentials in the GitHub repository. Tokens and the client secret entered through the setup page are encrypted using AES-GCM and saved on the persistent disk. APP_SECRET must survive redeploys. The app refreshes the Webex access token when a reporting request needs it and expiry is approaching; it is not yet a background reporting poller. OAuth validates a short-lived state cookie and record.

This package does not migrate existing tokens from the earlier hosted preview. Authorize Webex again after the Render service is available. The earlier preview remains available until you choose to retire it.
