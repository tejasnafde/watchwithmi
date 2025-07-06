#!/bin/bash
# 🌐 Setup Free Dynamic DNS for WatchWithMi

echo "🌐 Setting up free Dynamic DNS..."

# Option 1: No-IP (Free)
echo "1️⃣ No-IP Setup:"
echo "   - Go to: https://www.noip.com/sign-up"
echo "   - Create free account"
echo "   - Choose hostname like: yourname-watchwithmi.ddns.net"
echo "   - Install DUC client:"
echo "   wget https://www.noip.com/client/linux/noip-duc-linux.tar.gz"
echo "   tar xf noip-duc-linux.tar.gz"
echo "   cd noip-2.1.9-1/"
echo "   make install"

# Option 2: DuckDNS (Simpler)
echo ""
echo "2️⃣ DuckDNS Setup (Recommended):"
echo "   - Go to: https://www.duckdns.org"
echo "   - Login with Google/GitHub"
echo "   - Create subdomain: yourname-watchwithmi.duckdns.org"
echo "   - Get your token"

read -p "Do you want to setup DuckDNS now? (y/n): " setup_duckdns

if [[ $setup_duckdns == "y" ]]; then
    read -p "Enter your DuckDNS domain (without .duckdns.org): " duck_domain
    read -p "Enter your DuckDNS token: " duck_token
    
    # Create DuckDNS update script
    mkdir -p /home/$USER/duckdns
    cat > /home/$USER/duckdns/duck.sh << EOF
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=$duck_domain&token=$duck_token&ip=" | curl -k -o /home/$USER/duckdns/duck.log -K -
EOF
    
    chmod 700 /home/$USER/duckdns/duck.sh
    
    # Add to crontab (update every 5 minutes)
    (crontab -l 2>/dev/null; echo "*/5 * * * * /home/$USER/duckdns/duck.sh >/dev/null 2>&1") | crontab -
    
    # Run once now
    /home/$USER/duckdns/duck.sh
    
    echo "✅ DuckDNS setup complete!"
    echo "🌐 Your app will be available at: http://$duck_domain.duckdns.org"
    echo "📱 Share this URL with friends: http://$duck_domain.duckdns.org"
else
    echo "📝 Manual setup options:"
    echo ""
    echo "🦆 DuckDNS (Easiest):"
    echo "   1. Go to duckdns.org"
    echo "   2. Create: yourname-watchwithmi.duckdns.org"
    echo "   3. Add this to crontab: */5 * * * * curl 'https://www.duckdns.org/update?domains=YOURDOMAIN&token=YOURTOKEN'"
    echo ""
    echo "🚫 No-IP:"
    echo "   1. Go to noip.com/sign-up"
    echo "   2. Create: yourname-watchwithmi.ddns.net"
    echo "   3. Install their Linux client"
    echo ""
    echo "🌐 Afraid.org:"
    echo "   1. Go to freedns.afraid.org"
    echo "   2. Create: yourname-watchwithmi.mooo.com"
    echo ""
fi

# Setup port forwarding reminder
echo ""
echo "🔧 IMPORTANT: Router Configuration Needed!"
echo "   1. Access your router admin panel (usually http://192.168.1.1)"
echo "   2. Find 'Port Forwarding' or 'Virtual Server'"
echo "   3. Forward external port 80 to your Pi's IP:80"
echo "   4. Your Pi's IP: $(hostname -I | cut -d' ' -f1)"
echo ""
echo "📋 Port Forwarding Settings:"
echo "   - Service Name: WatchWithMi"
echo "   - External Port: 80"
echo "   - Internal IP: $(hostname -I | cut -d' ' -f1)"
echo "   - Internal Port: 80"
echo "   - Protocol: TCP"

# Optional: SSL setup
echo ""
echo "🔒 Optional SSL Setup (HTTPS):"
echo "   After everything works on HTTP, you can add free SSL:"
echo "   sudo apt install certbot python3-certbot-nginx"
echo "   sudo certbot --nginx -d yourdomain.duckdns.org" 