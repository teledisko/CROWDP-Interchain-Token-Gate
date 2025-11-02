# CROWDP Interchain Token Gate - Deployment Guide

## 🚀 Live Application URLs

### Production Services
- **Web Application**: TBD
- **Role Assignment Server**: local
- **Balance Monitor**: local

## 📋 Server Information

- **Server**: AWS EC2 Instance
- **Address**: `ec2-54-245-196-251.us-west-2.compute.amazonaws.com`
- **SSH Key**: `CrowdpunkServer.pem`
- **User**: `ubuntu`

## 🔧 Services Status

All services are running via PM2 process manager:

| Service | Status | Port | Memory | Process ID |
|---------|--------|------|--------|------------|
| web-app | ✅ Online | 3000 | 31.3MB | 1730 |
| role-server | ✅ Online | 8001 | 67.4MB | 2100 |
| balance-monitor | ✅ Online | 8002 | 38.6MB | 2162 |
| discord-bot | ✅ Online | N/A | 5.9MB | 2556 |

## 🌐 Cloudflare Tunnels

Each service is exposed through Cloudflare tunnels for secure public access:

### Web Application Tunnel
- **Local Port**: 3000
- **Public URL**: https://performer-drawings-daniel-bruce.trycloudflare.com
- **Command**: `cloudflared tunnel --url http://localhost:3000`

### Role Assignment Server Tunnel
- **Local Port**: 8001
- **Public URL**: https://locations-electronic-stanley-award.trycloudflare.com
- **Command**: `cloudflared tunnel --url http://localhost:8001`

### Balance Monitor Tunnel
- **Local Port**: 8002
- **Public URL**: https://load-workstation-frame-proposal.trycloudflare.com
- **Command**: `cloudflared tunnel --url http://localhost:8002`

## 🔐 Environment Configuration

### Web Application (.env.local)
```env
MONGODB_URI=mongodb+srv://piyushgarg:piyushgarg@cluster0.wnqhj.mongodb.net/crowdp?retryWrites=true&w=majority
DISCORD_CLIENT_ID=1291764768779718686
NEXTAUTH_URL=https://performer-drawings-daniel-bruce.trycloudflare.com
NEXTAUTH_SECRET=your-secret-key-here
DISCORD_CLIENT_SECRET=your-discord-client-secret
JWT_SECRET=your-jwt-secret-here
DISCORD_BOT_API_KEY=your-discord-bot-api-key
```

### Discord Bot (.env)
```env
DISCORD_BOT_TOKEN=your-discord-bot-token
WEB_APP_URL=https://performer-drawings-daniel-bruce.trycloudflare.com
MONGODB_URI=mongodb+srv://piyushgarg:piyushgarg@cluster0.wnqhj.mongodb.net/crowdp?retryWrites=true&w=majority
COSMOS_CHAIN_ID=cosmoshub-4
DISCORD_GUILD_ID=your-guild-id
DISCORD_BOT_API_KEY=your-discord-bot-api-key
JWT_SECRET=your-jwt-secret-here
```

## 📦 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS EC2 Server                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                PM2 Process Manager                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │  Web App    │ │ Role Server │ │ Balance Mon │   │   │
│  │  │  Port 3000  │ │  Port 8001  │ │  Port 8002  │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  │  ┌─────────────┐                                   │   │
│  │  │ Discord Bot │                                   │   │
│  │  │   (No Port) │                                   │   │
│  │  └─────────────┘                                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Cloudflare Tunnels                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   Tunnel 1  │ │   Tunnel 2  │ │   Tunnel 3  │          │
│  │ Web App URL │ │ Role Srv URL│ │ Balance URL │          │
│  └─────────────┘ └─────────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Deployment Process

### 1. Local Build
```bash
# Build the Next.js application locally
npm run build

# Create archive of build files
tar -czf web-app-build.tar.gz .next/
```

### 2. Upload to Server
```bash
# Upload build files
scp -i "CrowdpunkServer.pem" web-app-build.tar.gz ubuntu@ec2-54-245-196-251.us-west-2.compute.amazonaws.com:~/

# Extract on server
ssh -i "CrowdpunkServer.pem" ubuntu@ec2-54-245-196-251.us-west-2.compute.amazonaws.com
cd CROWDP-Interchain-Token-Gate/web-app
tar -xzf ~/web-app-build.tar.gz
```

### 3. Environment Setup
```bash
# Create environment files
# .env.local for web app
# .env for discord bot
```

### 4. Dependencies Installation
```bash
# Web app dependencies
cd web-app && npm install

# Discord bot dependencies
cd discord-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 5. Start Services
```bash
# Start all services with PM2
pm2 start ecosystem.config.js
pm2 start discord-bot/ecosystem.config.js
pm2 start role_assignment_server.py --name role-server --interpreter python3 -- --port 8001
pm2 start balance_monitor.py --name balance-monitor --interpreter python3 -- --port 8002
```

### 6. Setup Tunnels
```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Start tunnels (run in separate terminals)
cloudflared tunnel --url http://localhost:3000
cloudflared tunnel --url http://localhost:8001
cloudflared tunnel --url http://localhost:8002
```

## 🔍 Monitoring & Management

### PM2 Commands
```bash
# Check status
pm2 status

# View logs
pm2 logs [service-name]

# Restart service
pm2 restart [service-name]

# Stop service
pm2 stop [service-name]
```

### Tunnel Management
- Tunnels are temporary and will generate new URLs on restart
- For production, consider using named tunnels with Cloudflare account
- Monitor tunnel status through terminal outputs

## 🔒 Security Notes

- Environment variables contain sensitive information
- MongoDB URI includes authentication credentials
- Discord bot tokens and API keys are configured
- All services are behind Cloudflare tunnels for security

## 📞 Support

For issues or questions regarding deployment:
1. Check PM2 logs: `pm2 logs [service-name]`
2. Verify tunnel connectivity
3. Ensure environment variables are properly set
4. Check server resources and connectivity

---

**Last Updated**: October 4, 2025
**Deployment Status**: ✅ All Services Online