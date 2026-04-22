# 🥧 Raspberry Pi Setup Guide for WatchWithMi

## Hardware Requirements

### ✅ **Recommended: Raspberry Pi 4 (4GB+)**
- **RAM**: 4GB+ recommended (2GB minimum)
- **Storage**: 32GB+ microSD card (Class 10/U1 or better)
- **Network**: Ethernet preferred over WiFi for stability
- **Power**: Official Pi power supply (important!)

### ✅ **Will Work: Raspberry Pi 3B+**
- Slower but functional
- 1GB RAM might be limiting with many concurrent users

## Complete Setup (30 minutes)

### 1. **Install Raspberry Pi OS**
```bash
# Download Raspberry Pi Imager
# Flash "Raspberry Pi OS Lite" (64-bit) to SD card
# Enable SSH and set username/password during flash

# First boot - update system
sudo apt update && sudo apt upgrade -y
```

### 2. **Install Docker**
```bash
# Install Docker (handles all dependencies)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker pi

# Enable Docker to start on boot
sudo systemctl enable docker

# Logout and login again for docker group to take effect
exit
```

### 3. **Install Python & Dependencies**
```bash
# Install Python and pip
sudo apt install python3-pip python3-venv git -y

# Clone your project
cd /home/pi
git clone <your-repo-url> watchwithmi
cd watchwithmi

# Create virtual environment
python3 -m venv watchwithmi-venv
source watchwithmi-venv/bin/activate

# Install requirements
pip install -r requirements.txt
```

### 4. **Setup Jackett (Torrent Indexer)**
```bash
# Run Jackett in Docker
docker run -d \
  --name=jackett \
  -e PUID=1000 \
  -e PGID=1000 \
  -p 9117:9117 \
  -v /home/pi/jackett-config:/config \
  --restart unless-stopped \
  linuxserver/jackett

# Wait 30 seconds for startup
sleep 30

# Check if running
docker ps | grep jackett
```

### 5. **Configure Jackett**
```bash
# Get Pi's IP address
hostname -I

# Open in browser: http://[PI_IP]:9117
# Example: http://192.168.1.100:9117
```

**In Jackett Web UI:**
1. **Add Indexers**: Click "Add indexer" 
   - 1337x
   - RARBG
   - The Pirate Bay  
   - Nyaa
   - TorrentGalaxy
   - Torznab (generic)
2. **Copy API Key**: Top of dashboard
3. **Test Search**: Try searching for "ubuntu"

### 6. **Configure WatchWithMi**
```bash
# Set Jackett API key
export JACKETT_API_KEY="your_api_key_from_jackett_dashboard"

# Add to .bashrc for persistence
echo 'export JACKETT_API_KEY="your_api_key_here"' >> ~/.bashrc

# Test the app
cd /home/pi/watchwithmi
source watchwithmi-venv/bin/activate
python3 run.py
```

### 7. **Test Everything**
```bash
# App should be running on:
# http://[PI_IP]:5000

# Try searching for "the prestige" - you should see:
# 📊 Jackett: 15 results
# 📊 Nyaa-CloudScraper: 3 results  
# 📊 BitSearch: 2 results
# ✅ Found 20 unique torrents (from 20 total)
```

## Auto-Start Services

### **Auto-start WatchWithMi**
```bash
# Create systemd service
sudo nano /etc/systemd/system/watchwithmi.service
```

```ini
[Unit]
Description=WatchWithMi
After=network.target docker.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/watchwithmi
Environment=JACKETT_API_KEY=your_api_key_here
ExecStart=/home/pi/watchwithmi/watchwithmi-venv/bin/python run.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable watchwithmi
sudo systemctl start watchwithmi

# Check status
sudo systemctl status watchwithmi
```

## Performance Optimization

### **For Pi 4 (4GB+)**
```bash
# Increase swap (optional)
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### **For Pi 3B+ or 2GB Pi 4**
```bash
# Reduce Docker container resources
docker update --memory="200m" --cpus="0.5" jackett

# Monitor resources
htop
docker stats
```

## Network Setup

### **External Access (Optional)**
```bash
# For access from outside your home network:

# 1. Set static IP on Pi
sudo nano /etc/dhcpcd.conf
# Add:
# static ip_address=192.168.1.100/24
# static routers=192.168.1.1
# static domain_name_servers=8.8.8.8

# 2. Port forward on router:
# - Port 5000 -> Pi IP:5000 (WatchWithMi)
# - Port 9117 -> Pi IP:9117 (Jackett)

# 3. Access via: http://your-public-ip:5000
```

### **Local Network Only (Recommended)**
- Access via `http://[PI_IP]:5000` from any device on your network
- More secure, no router configuration needed

## Troubleshooting

### **Common Issues:**

**"Docker command not found"**
```bash
# Logout and login again, or run:
newgrp docker
```

**"Jackett not responding"**
```bash
# Check logs
docker logs jackett

# Restart container
docker restart jackett
```

**"No torrent results"**
```bash
# Check if Jackett is working
curl http://localhost:9117

# Check indexers in Jackett web UI
# Try adding more indexers if some fail
```

**"App crashes with memory error"**
```bash
# Check available memory
free -h

# Restart services
sudo systemctl restart watchwithmi
docker restart jackett
```

**"Slow performance"**
```bash
# Check CPU/memory usage
htop

# Consider using faster SD card (Class 10/U3)
# Consider Pi 4 with 4GB+ RAM
```

## Resource Usage

### **Expected Resource Usage:**
- **WatchWithMi**: ~50-100MB RAM, low CPU
- **Jackett**: ~30-50MB RAM, low CPU  
- **Total**: ~100-150MB RAM usage
- **Pi 4 (4GB)**: Plenty of headroom
- **Pi 4 (2GB)**: Should work fine
- **Pi 3B+**: Usable but slower

### **Concurrent Users:**
- **Pi 4**: 5-10 concurrent users
- **Pi 3B+**: 2-5 concurrent users

## Benefits of Pi Setup

✅ **24/7 availability** - always-on home server  
✅ **Low power consumption** - ~5W vs desktop ~200W  
✅ **Silent operation** - no fans  
✅ **Complete control** - no cloud dependencies  
✅ **Privacy** - all data stays local  
✅ **Cost effective** - ~$75 total hardware cost  
✅ **Learning experience** - great for learning Linux/Docker  

## Next Steps

Once everything is working:
1. **Add more Jackett indexers** for better results
2. **Setup VPN** on Pi for privacy (optional)
3. **Add reverse proxy** with SSL (advanced)
4. **Backup configuration** regularly
5. **Monitor logs** for any issues

Your Pi will now be a complete WatchWithMi server with excellent torrent search capabilities! 🎉 