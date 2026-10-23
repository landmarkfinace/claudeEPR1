# Production Deployment — Contabo VPS (Ubuntu 24.04)

This guide deploys the **Landmark Inter Gulf — Workforce, Payroll & Accounts
System** (Next.js 16 · Prisma · SQLite · Bun) from a fresh Ubuntu 24.04 server
to a production service with auto-restart, HTTPS and backups.

Total time: **~20 minutes**. All commands run as `root` (or with `sudo`).

---

## 0. What you need

| Item | Example |
|---|---|
| Contabo VPS (Ubuntu 24.04, 4 GB+ RAM) | IP `203.0.113.10` |
| GitHub repo access | `https://github.com/landmarkfinace/claudeEPR1.git` |
| (Optional) a domain pointed at the VPS | `erp.yourcompany.com` |

The app listens on **port 3000**; Caddy exposes it on **80/443** with free
HTTPS. The database is a single SQLite file — no database server needed.

---

## 1. Server prep

```bash
apt update && apt -y upgrade
apt -y install git curl ufw

# Firewall: SSH + web only (the app stays on localhost:3000)
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Add a swap file (recommended on 4 GB VPS — the production build uses ~2 GB):

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Install Bun (runs the app)

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version   # should print 1.x
```

## 3. Get the code

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/landmarkfinace/claudeEPR1.git
cd claudeEPR1
```

## 4. Configure the environment

```bash
cp .env.example .env
nano .env
```

Set the database path to the **absolute** server path:

```env
DATABASE_URL=file:/opt/claudeEPR1/db/custom.db
```

Leave `PRINT_*` commented (Chrome is found automatically after step 7).
`ADMIN_EMAIL` / `ADMIN_PASSWORD` are only used once in step 6.

## 5. Install dependencies + create the database

```bash
bun install            # also runs `prisma generate` (postinstall)
bunx prisma db push    # creates db/custom.db with all tables
```

> ⚠ **NEVER run `bun run db:seed` in production** — that script inserts DEMO
> data. Production starts from the bootstrap in the next step.

## 6. Bootstrap the company configuration + admin user

```bash
ADMIN_EMAIL='boss@landmarkintergulf.com' \
ADMIN_PASSWORD='Choose-A-Strong-Password' \
bun run db:bootstrap
```

This installs: the 4 roles, all company settings (name, address, C.R., VAT,
bank details), the letterhead artwork, staff categories, transaction
categories, agreement template, name-list subjects, AI settings and the
translation memory — everything captured from the company's live setup.
It is **idempotent** (safe to re-run; it never overwrites your edits).

## 7. Install Google Chrome (server-side PDF printing)

Pay slips, quotations, e-invoices, agreements, name lists, client summaries —
all "Download PDF" buttons render through a local headless-Chrome daemon.

```bash
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt update && apt -y install google-chrome-stable fonts-noto-color-emoji
```

(If you skip this, the app still runs — only PDF downloads fail with
"No Chromium executable found".)

## 8. Build + first run

```bash
bun run build
bun run start
```

You should see `✓ Ready in ...`. Test from your PC:
`http://SERVER_IP:3000` → login with your bootstrap admin email/password.
Then `Ctrl+C` to stop — we'll run it as a service instead.

## 9. Run as a systemd service (auto-start + auto-restart)

```bash
cat > /etc/systemd/system/landmark.service <<'EOF'
[Unit]
Description=Landmark Inter Gulf ERP
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/claudeEPR1/.next/standalone
ExecStart=/root/.bun/bin/bun --env-file=/opt/claudeEPR1/.env /opt/claudeEPR1/.next/standalone/server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now landmark
systemctl status landmark --no-pager
```

## 10. Caddy reverse proxy + HTTPS (optional but recommended)

```bash
apt -y install caddy
```

Edit `/etc/caddy/Caddyfile`:

```
erp.yourcompany.com {
    reverse_proxy 127.0.0.1:3000
}
```

(No domain yet? Use `:80 { reverse_proxy 127.0.0.1:3000 }` to test by IP.)

```bash
systemctl reload caddy
```

## 11. Daily database backup (cron)

The whole database is ONE file — back it up with sqlite3's safe online backup:

```bash
apt -y install sqlite3
cat > /opt/claudeEPR1/backup.sh <<'EOF'
#!/bin/bash
mkdir -p /opt/backups
sqlite3 /opt/claudeEPR1/db/custom.db ".backup '/opt/backups/erp-$(date +%F-%H%M).db'"
gzip -f /opt/backups/erp-$(date +%F-%H%M).db
find /opt/backups -name '*.gz' -mtime +30 -delete
EOF
chmod +x /opt/claudeEPR1/backup.sh
crontab -e   # add this line (daily 02:30):
# 30 2 * * * /opt/claudeEPR1/backup.sh
```

---

## Updating the app

```bash
cd /opt/claudeEPR1
systemctl stop landmark
git pull
bun install
bunx prisma db push        # applies any new schema (data preserved)
bun run build
systemctl start landmark
```

## Troubleshooting

| Problem | Check |
|---|---|
| Service won't start | `journalctl -u landmark -n 50` |
| 500 on every API | `.env` missing/typo → `systemctl restart landmark` after fixing |
| PDF download fails | `cat /opt/claudeEPR1/print-daemon.log`; verify Chrome: `google-chrome --version`; or set `PRINT_CHROME=/usr/bin/google-chrome-stable` in `.env` |
| Login rejected | DB bootstrapped? `sqlite3 db/custom.db 'select email from User;'` |
| Build killed (exit 137) | Out of RAM — add/enable swap (step 1), then rebuild |

## Security checklist (first login)

1. **Settings → Users** — change the admin password, add your real users.
2. Rotate the GitHub token used for the clone URL (it grants repo access).
3. Keep `ufw` enabled; never expose port 3000 directly (`ufw deny 3000/tcp`).
4. Confirm HTTPS in Caddy before real use (login cookies are HttpOnly but
   should also ride TLS).
