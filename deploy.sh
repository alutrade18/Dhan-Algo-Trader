#!/bin/bash
set -e

echo "=== Dhan Algo Trader - Deploy Script ==="

PROJECT=/var/www/trading
DB_URL="postgresql://trading_user:Trade@2024#Secure@localhost:5432/trading_db"
ENCRYPTION_KEY="a89df3bece84e2b1256ef90f058642996cea58e478f7812156c5af5062c29473"
API_PORT=3001
SERVER_IP="68.183.247.209"

echo ""
echo "--- Step 1: Updating .env file ---"
cat > $PROJECT/.env << EOF
NODE_ENV=production
DATABASE_URL=$DB_URL
PORT=$API_PORT
ENCRYPTION_KEY=$ENCRYPTION_KEY
ALLOWED_ORIGINS=http://$SERVER_IP
EOF
echo ".env updated"

echo ""
echo "--- Step 2: Database migration ---"
cd $PROJECT/lib/db
DATABASE_URL=$DB_URL ./node_modules/.bin/drizzle-kit push
echo "Database ready"

echo ""
echo "--- Step 3: Build API server ---"
cd $PROJECT
PORT=$API_PORT pnpm --filter @workspace/api-server run build
echo "API server built"

echo ""
echo "--- Step 4: Build Frontend ---"
PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/trading-platform run build
echo "Frontend built"

echo ""
echo "--- Step 5: Start API server with PM2 ---"
pm2 delete dhan-api 2>/dev/null || true
pm2 start $PROJECT/artifacts/api-server/dist/index.mjs \
  --name dhan-api \
  --env production \
  --env-file $PROJECT/.env
pm2 save
echo "PM2 started"

echo ""
echo "--- Step 6: Nginx config ---"
cat > /etc/nginx/sites-available/trading << 'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/trading/artifacts/trading-platform/dist/public;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:3001;
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
NGINX

ln -sf /etc/nginx/sites-available/trading /etc/nginx/sites-enabled/trading
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "Nginx configured"

echo ""
echo "=== DEPLOY COMPLETE ==="
echo "App running at: http://$SERVER_IP"
echo "API running on port: $API_PORT"
