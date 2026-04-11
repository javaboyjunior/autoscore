# Deployment Guide — AWS Lightsail (Single Ubuntu Instance)

PostgreSQL and the Node app run on the same server. Nginx sits in front on ports 80/443 and proxies to Node on port 3000. PM2 keeps Node alive. Certbot handles SSL. A GitHub webhook triggers auto-deploys on push to main, which pulls the latest code, runs `npm run build` (Vite), and restarts PM2.

---

## 1. Create the Lightsail instance

1. Open [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com) → **Create instance**.
2. **Platform**: Linux/Unix. **Blueprint**: OS Only → **Ubuntu 22.04 LTS**.
3. **Plan**: $10/month (2 GB RAM) minimum.
4. Create or attach a key pair; download the `.pem` file.
5. **Instance name**: `autoscore`.
6. Click **Create instance** and wait ~60 seconds.

---

## 2. Attach a static IP

Lightsail → **Networking** → **Create static IP** → attach to `autoscore`. Note the IP (called `YOUR_IP` below).

---

## 3. Open firewall ports

Instance → **Networking** → **IPv4 Firewall** — ensure these rules exist:

| Application | Protocol | Port |
|---|---|---|
| SSH | TCP | 22 |
| HTTP | TCP | 80 |
| HTTPS | TCP | 443 |

Ports 3000 and 5432 stay closed — local only.

---

## 4. Point DNS to the instance

At your DNS provider create two A records:

| Name | Type | Value |
|---|---|---|
| `@` | A | `YOUR_IP` |
| `www` | A | `YOUR_IP` |

---

## 5. SSH into the instance

```bash
chmod 400 /path/to/your-key.pem
ssh -i /path/to/your-key.pem ubuntu@YOUR_IP
```

All remaining commands run on the server unless noted.

---

## 6. Update the system

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 7. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x.x
```

---

## 8. Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

---

## 9. Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## 10. Install PM2

```bash
sudo npm install -g pm2
```

---

## 11. Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## 12. Install AWS CLI (for S3 backups)

```bash
sudo apt install -y awscli
```

---

## 13. Create the PostgreSQL database and user

```bash
sudo -u postgres psql <<'SQL'
CREATE USER autoscore WITH PASSWORD 'YOURPASSWORD';
CREATE DATABASE autoscore OWNER autoscore;
\q
SQL
```

Verify:
```bash
psql postgresql://autoscore:YOURPASSWORD@localhost:5432/autoscore -c '\l'
```

---

## 14. Clone the repository

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/autoscore.git /home/ubuntu/autoscore
cd /home/ubuntu/autoscore
```

---

## 15. Install dependencies and build

```bash
npm install
npm run build   # Vite compiles React → dist/
```

---

## 16. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in every value:
```dotenv
DATABASE_URL=postgresql://autoscore:YOURPASSWORD@localhost:5432/autoscore
GITHUB_SECRET=<run: openssl rand -hex 32>
S3_BUCKET_NAME=your-s3-bucket-name
AWS_DEFAULT_REGION=us-east-1
PORT=3000
```

---

## 17. Run the database schema

```bash
psql postgresql://autoscore:YOURPASSWORD@localhost:5432/autoscore \
  < scripts/init-db.sql
```

You should see `CREATE TABLE`, `CREATE INDEX`, `CREATE TRIGGER` with no errors.

---

## 18. Start the app with PM2

```bash
pm2 start ecosystem.config.js
pm2 status   # → autoscore   online
pm2 logs autoscore --lines 30
```

Configure PM2 to start on reboot:
```bash
pm2 save
pm2 startup
# Copy and run the printed sudo command exactly
```

Test locally:
```bash
curl http://localhost:3000/api/events
# → []
```

---

## 19. Configure Nginx

Create the initial HTTP-only config:
```bash
sudo nano /etc/nginx/sites-available/autoscore
```

Paste (replace YOUR_DOMAIN):
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name YOUR_DOMAIN www.YOUR_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_read_timeout 3600s;
    }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/autoscore /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 20. Set up SSL with Certbot

```bash
dig YOUR_DOMAIN +short   # must return YOUR_IP first

sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

Then install the final nginx config (adds `proxy_buffering off` for SSE):
```bash
# Edit nginx.conf in the repo — replace YOUR_DOMAIN with your actual domain
sudo cp /home/ubuntu/autoscore/nginx.conf /etc/nginx/sites-available/autoscore
sudo nginx -t && sudo systemctl reload nginx
```

---

## 21. Set up the GitHub webhook for auto-deploy

Make deploy.sh executable:
```bash
chmod +x /home/ubuntu/autoscore/deploy.sh
```

On GitHub → your repo → **Settings** → **Webhooks** → **Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://YOUR_DOMAIN/hooks/deploy` |
| Content type | `application/json` |
| Secret | value of `GITHUB_SECRET` from `.env` |
| Which events | **Just the push event** |

Push any commit to `main` and watch:
```bash
tail -f /home/ubuntu/.pm2/logs/deploy.log
```

---

## 22. Set up daily S3 backups

**Test manually first:**
```bash
bash /home/ubuntu/autoscore/backup.sh
```

**Add the cron job:**
```bash
crontab -e
```

Add (runs 3:00 AM daily):
```
0 3 * * * /home/ubuntu/autoscore/backup.sh >> /home/ubuntu/.pm2/logs/backup.log 2>&1
```

---

## Quick reference

```bash
# View live logs
pm2 logs autoscore

# Restart manually
pm2 restart autoscore

# Deploy manually (same as webhook)
bash /home/ubuntu/autoscore/deploy.sh

# Connect to database
psql postgresql://autoscore:YOURPASSWORD@localhost:5432/autoscore

# Run backup manually
bash /home/ubuntu/autoscore/backup.sh

# Check Nginx
sudo nginx -t && sudo systemctl reload nginx

# Renew SSL
sudo certbot renew
```
