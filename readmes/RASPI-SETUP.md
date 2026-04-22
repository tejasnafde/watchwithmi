# 🍓 Raspberry Pi Production Setup Guide

## 🎯 Goal
Deploy WatchWithMi on your Raspberry Pi so friends worldwide can access it via a nice URL like `yourname-watchwithmi.duckdns.org`

## 📋 Requirements
- **Raspberry Pi 4** (2GB+ RAM recommended)
- **Micro SD Card** (32GB+ recommended)
- **Stable Internet** with router access
- **No domain purchase needed!** (we'll use free dynamic DNS)

---

## 🚀 Quick Setup (30 minutes)

### Step 1: Prepare Raspberry Pi
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Copy your project to Pi
scp -r /path/to/watchwithmi pi@192.168.1.X:/home/pi/
```

### Step 2: Run deployment script
```bash
# Make scripts executable
chmod +x raspi-deploy.sh setup-ddns.sh

# Deploy the app
sudo ./raspi-deploy.sh

# Setup free domain
./setup-ddns.sh
```

### Step 3: Configure router
1. Open router admin (usually `http://192.168.1.1`)
2. Find "Port Forwarding" or "Virtual Server"
3. Forward external port `80` to your Pi's IP port `80`

---

## 🌐 Free Domain Options (No Purchase Required)

### Option 1: DuckDNS (Recommended)
- **URL**: `yourname-watchwithmi.duckdns.org`
- **Cost**: Free forever
- **Setup**: 5 minutes
- **Reliability**: Excellent

### Option 2: No-IP
- **URL**: `yourname-watchwithmi.ddns.net` 
- **Cost**: Free (with manual renewal every 30 days)
- **Setup**: 10 minutes
- **Reliability**: Good

### Option 3: Afraid.org
- **URL**: `yourname-watchwithmi.mooo.com`
- **Cost**: Free forever
- **Setup**: 5 minutes
- **Reliability**: Good

---

## ⚡ Performance Optimization

### Pi 4 Specific Tweaks
```bash
# Increase GPU memory for video processing
echo "gpu_mem=128" | sudo tee -a /boot/config.txt

# Enable hardware acceleration
echo "dtoverlay=vc4-fkms-v3d" | sudo tee -a /boot/config.txt

# Reboot to apply
sudo reboot
```

### Storage Optimization
```bash
# Use external SSD for better I/O (optional)
# Mount external drive to /opt/watchwithmi for better performance

# Or optimize SD card
echo "tmpfs /tmp tmpfs defaults,noatime,nosuid,size=100m 0 0" | sudo tee -a /etc/fstab
```

---

## 🔧 Maintenance Commands

### Check service status
```bash
sudo systemctl status watchwithmi-backend
sudo systemctl status watchwithmi-frontend
sudo systemctl status nginx
```

### View logs
```bash
sudo journalctl -u watchwithmi-backend -f
sudo journalctl -u watchwithmi-frontend -f
```

### Restart services
```bash
sudo systemctl restart watchwithmi-backend
sudo systemctl restart watchwithmi-frontend
sudo systemctl restart nginx
```

### Update app
```bash
cd /opt/watchwithmi
git pull
sudo systemctl restart watchwithmi-backend watchwithmi-frontend
```

---

## 🛡️ Security (Important!)

### Basic Security
```bash
# Change default Pi password
passwd

# Setup SSH keys (disable password login)
ssh-keygen -t rsa -b 4096
# Copy public key to Pi, then:
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no

# Auto updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure unattended-upgrades
```

### Advanced Security
```bash
# Fail2ban (blocks brute force attempts)
sudo apt install fail2ban

# Rate limiting in nginx
# Add to nginx config:
# limit_req_zone $binary_remote_addr zone=api:10m rate=10r/m;
# limit_req zone=api burst=5;
```

---

## 🌍 Sharing with Friends

Once everything is set up:

1. **Your URL**: `http://yourname-watchwithmi.duckdns.org`
2. **Share this link** with friends anywhere in the world
3. **They can access** without any VPN or special setup
4. **Works on phones, tablets, computers** - any device with a browser

### Testing checklist:
- [ ] Can access locally: `http://192.168.1.X`
- [ ] Can access via domain: `http://yourname-watchwithmi.duckdns.org`
- [ ] Friends can access from outside your network
- [ ] Video streaming works
- [ ] Chat works
- [ ] Room creation/joining works

---

## 💰 Cost Breakdown

| Item | Cost | Notes |
|------|------|-------|
| **Raspberry Pi 4** | $35-75 | One-time purchase |
| **Micro SD Card** | $15-25 | 32GB+ recommended |
| **Domain** | **$0** | Using free dynamic DNS |
| **Hosting** | **$0** | Self-hosted |
| **SSL Certificate** | **$0** | Free Let's Encrypt |
| **Total** | **$50-100** | One-time cost, runs forever |

---

## 🎮 Advanced Features

### Add HTTPS (Free SSL)
```bash
# After HTTP works, add SSL:
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourname-watchwithmi.duckdns.org
```

### Backup & Monitoring
```bash
# Auto backup (weekly)
sudo crontab -e
# Add: 0 2 * * 0 tar -czf /home/pi/backup-$(date +%Y%m%d).tar.gz /opt/watchwithmi

# Simple monitoring
sudo apt install htop iotop
```

---

## 🚨 Troubleshooting

### Common Issues:

**1. Can't access from outside network**
- Check router port forwarding (port 80 → Pi IP:80)
- Check Pi firewall: `sudo ufw status`

**2. Domain not resolving**
- Check dynamic DNS is updating: `nslookup yourname-watchwithmi.duckdns.org`
- Verify cron job: `crontab -l`

**3. Services not starting**
- Check logs: `sudo journalctl -u watchwithmi-backend -f`
- Check permissions: `ls -la /opt/watchwithmi`

**4. Slow performance**
- Monitor resources: `htop`
- Consider external SSD for storage
- Increase swap if needed

### Support Commands:
```bash
# Full system status
./raspi-deploy.sh --status

# Reset everything
./raspi-deploy.sh --reset

# Update app
./raspi-deploy.sh --update
```

## 🎉 You're Ready!

Your Pi is now a production server hosting WatchWithMi! Friends can access it worldwide via your free domain. Perfect for movie nights, sports watching, or just hanging out online! 🍿🎬 