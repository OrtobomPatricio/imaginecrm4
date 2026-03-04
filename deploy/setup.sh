#!/bin/bash
set -e

# ==============================================================================
# VPS Initial Setup Script
# Installs minimum requirements: Docker, Git, Nano, Curl, OpenSSL, Nginx, UFW
# Run this as root on a fresh Ubuntu/Debian VPS.
# ==============================================================================

echo "🔵 Updating system packages..."
apt-get update && apt-get upgrade -y

echo "🔵 Installing basic tools (git, nano, curl, openssl)..."
apt-get install -y git nano curl openssl ca-certificates gnupg

echo "🔵 Installing Nginx and UFW..."
apt-get install -y nginx ufw

echo "🔵 Installing Docker Engine + Docker Compose..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
    echo "✅ Docker installed successfully."
else
    echo "✅ Docker is already installed."
fi

echo "🔵 Configuring Firewall (UFW)..."
# Allow SSH to prevent lockout, and Web traffic
ufw allow OpenSSH
ufw allow 'Nginx Full' 
# Not enabling automatically to prevent accidental lockout, user should run 'ufw enable'
echo "⚠️  UFW rules added for SSH and Nginx. Run 'ufw enable' to activate firewall."

echo "🔵 Verifying installations..."
docker --version
git --version
nginx -v
openssl version

echo ""
echo "✅ Setup complete! server is ready for deployment."
echo "Next steps:"
echo "1. Clone your repo: git clone https://github.com/OrtobomPatricio/crmpro.git"
echo "2. Configure .env file"
echo "3. Run: docker compose up -d --build"
