# PayTrack — Hostinger deploy runbook

Prereqs (you provide): a **Node-capable** Hostinger plan (VPS or Cloud/Business — not plain PHP shared hosting), **SSH access**, and a **domain/subdomain** pointed at the server (DNS A-record). Then the steps below (I can run most of them once you give me SSH access).

## 1. Server prep (once)
```bash
# Node LTS + PM2 + Nginx + certbot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
sudo npm i -g pm2
```

## 2. Database (Hostinger MySQL)
Create a MySQL database + user in hPanel. Note the name/user/password → they go in `DATABASE_URL`.

## 3. Code + env
```bash
git clone <repo> paytrack && cd paytrack
cp .env.production.example .env      # then fill in real values (secrets stay here, never committed)
npm ci
```
Generate secrets: `openssl rand -base64 32` (AUTH_SECRET), `openssl rand -hex 24` (CRON_SECRET).

## 4. Schema + real users
```bash
npx prisma migrate deploy            # creates tables on Hostinger MySQL
npm run db:seed                      # seeds the users (NO demo data unless SEED_DEMO=1)
# set each user's real password (temp is paytrack123 until you do):
npm run set-password -- mahesh@payment.com "a-strong-password"
# ...repeat for jignesh / jagat / bhadresh
```
Keep `AUTH_WHITELIST` in `.env` identical to the seeded users' login IDs.

## 5. Uploads dir (persistent, outside web root)
```bash
mkdir -p "$UPLOAD_DIR" && chown -R $USER "$UPLOAD_DIR"   # path matches .env UPLOAD_DIR
```

## 6. Build + run under PM2
```bash
npm run build
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

## 7. Nginx + SSL
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/paytrack
# edit server_name to your domain
sudo ln -s /etc/nginx/sites-available/paytrack /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com    # adds the 443/SSL block
```

## 8. Cron (15-min reminders)
Add to crontab (`crontab -e`), using the CRON_SECRET from `.env`:
```
*/15 * * * * curl -fsS -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://your-domain.com/api/cron/reminders >/dev/null 2>&1
```

## 9. Backups (set up once, test a restore)
```bash
# nightly MySQL dump + uploads copy
0 2 * * * mysqldump -u DB_USER -pDB_PASS DB_NAME | gzip > /backups/paytrack-$(date +\%F).sql.gz
0 2 * * * tar czf /backups/uploads-$(date +\%F).tgz "$UPLOAD_DIR"
```
Restore once into a scratch DB to confirm the dump is good.

## Go-live checks
- [ ] `https://your-domain.com` loads over SSL.
- [ ] Each of the 4 users can sign in with their login ID + password (temp password changed).
- [ ] One payment taken raised → scheduled → paid-with-proof → confirmed.
- [ ] Payer receives the 15-min Telegram reminder (bot token live + each user /started the bot).
- [ ] `x-cron-secret` rejects a request without the header.
