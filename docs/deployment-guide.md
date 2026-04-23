# Dhan Algo Trader — DigitalOcean Deployment Guide

## Prerequisites
- DigitalOcean Droplet (Ubuntu 22.04, min 1GB RAM recommended 2GB)
- Reserved/Static IP assigned to Droplet
- GitHub repo: https://github.com/alutrade18/Dhan-Algo-Trader

---

## Step 1: Server Initial Setup

```bash
# Install curl, Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install pnpm
npm install -g pnpm@10.33.2

# Install PM2
npm install -g pm2

# Install Nginx
apt-get install -y nginx

# Install PostgreSQL
apt-get install -y postgresql postgresql-contrib
```

---

## Step 2: PostgreSQL Database Setup

```bash
# Open PostgreSQL shell
sudo -u postgres psql

# Inside psql — run these one by one:
CREATE DATABASE trading_db;
CREATE USER trading_user WITH PASSWORD 'Trade@2024#Secure';
GRANT ALL PRIVILEGES ON DATABASE trading_db TO trading_user;
ALTER DATABASE trading_db OWNER TO trading_user;
\q
```

---

## Step 3: Clone Code from GitHub

```bash
git clone https://github.com/alutrade18/Dhan-Algo-Trader.git /var/www/trading
cd /var/www/trading
```

---

## Step 4: Install Dependencies

```bash
pnpm install

# Also install inside lib/db (needed for drizzle-kit)
cd /var/www/trading/lib/db && pnpm install
cd /var/www/trading
```

---

## Step 5: Add Swap Space (if 1GB RAM Droplet)

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

---

## Step 6: Create .env File

```bash
nano /var/www/trading/.env
```

Paste this (change values as needed):
```
NODE_ENV=production
DATABASE_URL=postgresql://trading_user:Trade%402024%23Secure@localhost:5432/trading_db
PORT=3001
ENCRYPTION_KEY=a89df3bece84e2b1256ef90f058642996cea58e478f7812156c5af5062c29473
ALLOWED_ORIGINS=http://YOUR_SERVER_IP
```

Save: **Ctrl+X → Y → Enter**

> Note: `@` in password = `%40`, `#` = `%23` in DATABASE_URL

---

## Step 7: Database Migration

```bash
cd /var/www/trading/lib/db
DATABASE_URL=postgresql://trading_user:Trade%402024%23Secure@localhost:5432/trading_db ./node_modules/.bin/drizzle-kit push
cd /var/www/trading
```

---

## Step 8: Build API Server

```bash
PORT=3001 pnpm --filter @workspace/api-server run build
```

---

## Step 9: Build Frontend

```bash
PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/trading-platform run build
```

---

## Step 10: Create PM2 Ecosystem File

```bash
cat > /var/www/trading/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'dhan-api',
    script: '/var/www/trading/artifacts/api-server/dist/index.mjs',
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      DATABASE_URL: 'postgresql://trading_user:Trade%402024%23Secure@localhost:5432/trading_db',
      ENCRYPTION_KEY: 'a89df3bece84e2b1256ef90f058642996cea58e478f7812156c5af5062c29473',
      ALLOWED_ORIGINS: 'http://YOUR_SERVER_IP'
    }
  }]
}
EOF
```

---

## Step 11: Start API Server with PM2

```bash
pm2 start /var/www/trading/ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Step 12: Configure Nginx

```bash
cat > /etc/nginx/sites-available/trading << 'EOF'
server {
    listen 80;
    server_name _;

    root /var/www/trading/artifacts/trading-platform/dist/public;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/trading
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
```

---

## Done!

App is live at: `http://YOUR_SERVER_IP`

Go to Settings → Enter Dhan Client ID + Access Token → Save

---

## Update Workflow (After Code Changes)

**On Replit Shell — push to GitHub:**
```bash
git add -A && git commit -m "update" && git push origin main
```

**On DO Server — pull and rebuild:**
```bash
cd /var/www/trading && git pull origin main && PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/trading-platform run build && PORT=3001 pnpm --filter @workspace/api-server run build && pm2 restart dhan-api
```

---

## Important Notes

- Each server needs its own `ENCRYPTION_KEY` (generate with: `openssl rand -hex 32`)
- Each server's IP must be whitelisted in Dhan portal separately
- Dhan IP whitelist approval takes ~5 days
- Swap space is needed for 1GB RAM droplets during build
