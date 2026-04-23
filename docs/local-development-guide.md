# Local Development Guide — PC pe Code Change Kaise Kare

## Ek Baar Setup (Pehli Baar)

### Step 1: Git Install Karo
- Download: https://git-scm.com/download/win
- Install karo (sab default settings theek hain)

### Step 2: Node.js Install Karo
- Download: https://nodejs.org (LTS version — v20)
- Install karo

### Step 3: pnpm Install Karo
Command Prompt ya PowerShell mein:
```
npm install -g pnpm
```

### Step 4: GitHub Personal Access Token Banana
1. GitHub.com pe login karo
2. Top-right corner pe apna avatar click karo → **Settings**
3. Left sidebar mein neeche **Developer settings** click karo
4. **Personal access tokens** → **Tokens (classic)**
5. **Generate new token (classic)** click karo
6. Note likho: `trading-deploy`
7. Expiration: **No expiration**
8. Scope mein sirf **repo** tick karo
9. **Generate token** click karo
10. Token copy karke safe jagah save karo (ek baar hi dikhta hai)

---

## Code Download Karo (Pehli Baar)

```
git clone https://github.com/alutrade18/Dhan-Algo-Trader.git
cd Dhan-Algo-Trader
pnpm install
```

---

## Code Change Karna aur Push Karna

### Step 1: VS Code se open karo
```
code .
```
(VS Code download: https://code.visualstudio.com)

### Step 2: Apna change karo
Koi bhi file edit karo

### Step 3: GitHub pe push karo
```
git add -A
git commit -m "apna change yahan likho"
git push origin main
```

> Pehli baar push mein username aur password maanga toh:
> - Username: apna GitHub username
> - Password: upar banaya hua **Personal Access Token** paste karo

---

## DO Server pe Update Karo

Push karne ke baad DO server pe yeh run karo:

```
cd /var/www/trading && git pull origin main && PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/trading-platform run build && PORT=3001 pnpm --filter @workspace/api-server run build && pm2 restart dhan-api
```

---

## Agar Sirf Frontend Change Kiya Hai

Sirf yeh chalao (faster):
```
cd /var/www/trading && git pull origin main && PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/trading-platform run build
```
Nginx automatically new files serve karega — PM2 restart ki zaroorat nahi.

---

## Agar Sirf Backend (API) Change Kiya Hai

```
cd /var/www/trading && git pull origin main && PORT=3001 pnpm --filter @workspace/api-server run build && pm2 restart dhan-api
```

---

## Summary Flow

```
PC mein change karo
      ↓
git add -A && git commit -m "message" && git push origin main
      ↓
DO server pe: git pull && build && restart
      ↓
http://68.183.247.209 pe live!
```
