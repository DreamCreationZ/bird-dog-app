# EC2 Production Deployment (Bird Dog)

This setup runs both services on one EC2 instance:
- Next.js app (`npm run start`) on port `3000`
- Harvest worker (`npm run worker:harvest`)

Managed by PM2 behind Nginx.

## 1) Create EC2 host

- AMI: Ubuntu 24.04 LTS
- Instance type (starter): `t3.large` (upgrade based on load testing)
- Storage: at least 40 GB gp3
- Security Group:
  - `22` from office/VPN IPs only
  - `80` and `443` from internet

## 2) Install runtime

```bash
sudo apt update
sudo apt install -y nginx curl git certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 3) Checkout app

```bash
sudo mkdir -p /var/www/bird-dog-app
sudo chown -R $USER:$USER /var/www/bird-dog-app
git clone <your-repo-url> /var/www/bird-dog-app/current
cd /var/www/bird-dog-app/current
```

## 4) Configure production env

```bash
sudo mkdir -p /etc/bird-dog
sudo cp deploy/ec2/env.production.example /etc/bird-dog/.env.production
sudo chmod 600 /etc/bird-dog/.env.production
sudo nano /etc/bird-dog/.env.production
```

Set `APP_BASE_URL` to your HTTPS domain and fill all required keys.

## 5) Configure Nginx

```bash
sudo cp deploy/ec2/nginx.bird-dog.conf /etc/nginx/sites-available/bird-dog
sudo ln -s /etc/nginx/sites-available/bird-dog /etc/nginx/sites-enabled/bird-dog
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Update `server_name app.your-domain.com;` in the nginx file before reload.

## 6) First deploy

```bash
cd /var/www/bird-dog-app/current
bash deploy/ec2/scripts/deploy.sh
```

## 7) Enable PM2 startup on reboot

```bash
pm2 startup systemd
# Run the command PM2 prints (with sudo), then:
pm2 save
```

## 8) Enable HTTPS certificate

```bash
sudo certbot --nginx -d app.your-domain.com
```

## Operations

- Deploy latest `main`:
  ```bash
  cd /var/www/bird-dog-app/current
  bash deploy/ec2/scripts/deploy.sh
  ```
- Deploy another branch:
  ```bash
  cd /var/www/bird-dog-app/current
  BRANCH=release/your-branch bash deploy/ec2/scripts/deploy.sh
  ```
- PM2 logs:
  ```bash
  pm2 logs bird-dog-web
  pm2 logs bird-dog-harvest-worker
  ```
- Health check:
  ```bash
  curl -sS http://127.0.0.1:3000/api/health
  ```

## Scale path for high university traffic

For sustained heavy load, move from single instance to:
- ALB + Auto Scaling Group for app nodes
- Shared queue/worker tier for harvest jobs
- Managed Postgres/Supabase for data tier

This repo setup is compatible with that migration path.
