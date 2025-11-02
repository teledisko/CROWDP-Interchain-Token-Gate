# CrowdPunk Discord Role Assignment Bot — Client Guide

This document explains what the bot does, how users and admins interact with it inside Discord, where and how it's deployed, and how to install it in your Discord server. It's written for non-technical stakeholders while still including the key technical details your team needs.

## Installation Overview: Two-Component System

This is **not** a single installation package. The system consists of two separate components that work together:

1. **Discord Bot Service** - Runs on your VPS/server, handles Discord interactions and role assignments
2. **Web Application** - Also runs on your VPS/server, handles wallet connections and token verification

Both components must be deployed and configured on the same server to work together securely.

## What the Bot Does (High-Level)
- Helps members link their Discord account to your web app and verify Cosmos ecosystem token holdings.
- Assigns appropriate Discord roles based on token verification results.
- Provides a frictionless user flow via a button and two simple slash commands.

## Slash Commands Available in Discord
These commands are defined in the bot's role assignment service and are available once the bot is invited to your server.

### 1. `/connect`
- **Who can use it:** Any server member
- **What it does:** Sends an ephemeral message to the member with a "Connect Wallet & Discord" button that links to the web app.
- **Why it's needed:** This starts the verification flow. The member clicks the button, authorizes with Discord, and the web app checks their token holdings.

### 2. `/send-embed` (Admin only)
- **Who can use it:** Server admins
- **What it does:** Posts a visually rich announcement embed (with the "Connect Wallet & Discord" button) to a chosen channel.
- **Why it's needed:** Helps admins broadcast the onboarding link for verification to a public channel in your server.

**Note:** The button is a secure, standard Discord "link button" that takes the user to your web app (WEB_APP_URL). No sensitive data is exposed in the link.

## Bot's Backend API (Used by the Web App)
The web app calls the bot's internal API to assign roles after verification. These endpoints are not meant for public use and require an API key.

- **POST /assign-permanent-roles**
  - Purpose: Assigns one or more Discord roles to a verified user.
  - Auth: Requires header x-api-key that matches DISCORD_BOT_API_KEY in the bot's environment.
  - Inputs: discord_id (user), role_ids (list of role IDs), wallet_address.
  - Behavior: Checks permissions and role hierarchy, assigns roles, and sends the user a confirmation DM if possible.

- **GET /health**
  - Purpose: Health check to confirm the bot and API are running.
  - Output: Basic status, bot_ready flag, bot username.

## How the User Flow Works
1. User runs `/connect` or clicks the button in the admin announcement.
2. They are redirected to your web app where they:
   - Confirm Discord via OAuth (Discord's official flow).
   - Connect their wallet.
3. The web app evaluates token holdings and calls the bot's API with the roles the user qualifies for.
4. The bot assigns roles in Discord and (if possible) sends a DM confirmation to the user.

**Security notes:**
- OAuth uses pre-registered redirect URIs in the Discord Developer Portal and must match the web app's callback URL exactly.
- The bot's role assignment endpoint requires the correct API key.
- Role assignment respects Discord's permissions and role hierarchy.

## Where It's Deployed
- **Hosting:** Deployed on your VPS (AWS EC2).
- **Process management:** PM2 keeps the bot's service running (auto-restarts on failure).
- **Networking:**
  - The web app is publicly accessible via a Cloudflare tunnel URL.
  - The bot's API service runs on the same server and is accessed locally by the web app (not exposed publicly).
- **Databases and services:**
  - MongoDB used for user/session/state tracking.
  - Redis is **mandatory for production** and required for secure rate limiting; the app only falls back to in-memory in development environments.

This setup makes the bot private to your organization's Discord and avoids exposing the internal role assignment API to the internet.

## Discord Role Administration & Setup

### Creating and Managing Discord Roles
Before the bot can assign roles, you need to create them in your Discord server:

1. **Go to Server Settings** → Roles
2. **Create New Roles** for each token tier/category you want to verify:
   - Example roles: "Cosmos Holder", "ATOM Staker", "Osmosis LP", "Juno Validator", etc.
3. **Set Role Permissions** as needed (optional - roles can be purely cosmetic)
4. **Note the Role IDs** - You'll need these for configuration:
   - Right-click each role → "Copy ID" (requires Developer Mode enabled in Discord)
   - Or use the bot command `/role-info` if implemented

### Role Hierarchy Setup
**Critical:** The bot's role must be positioned **above** all roles it needs to assign:
1. Go to Server Settings → Roles
2. Drag the bot's role higher than your token verification roles
3. If the bot's role is below a target role, Discord will prevent assignment

### Configuring Token Requirements
In your web application's configuration, you'll map wallet token holdings to Discord role IDs:
- This is typically done in the web app's database or configuration files
- Example: "If user holds >100 ATOM tokens, assign role ID 123456789"
- The web app evaluates holdings and tells the bot which roles to assign

## Discord Developer Portal Configuration

### Bot Configuration
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → Your Application → Bot
2. **Required Intents** (enable these toggles):
   - ✅ **Server Members Intent** (required for role management)
   - ✅ **Message Content Intent** (if bot reads messages)
   - ✅ **Presence Intent** (optional, for user status)

### OAuth2 Configuration
1. Go to **OAuth2 → General**
2. **Redirect URIs** (add exact URLs):
   ```
   Development: http://localhost:3000/api/auth/discord/callback
   Production: https://your-domain.com/api/auth/discord/callback
   ```
   ⚠️ **Must match exactly** - including protocol (http/https)

3. Go to **OAuth2 → URL Generator**
4. **Scopes** (select these):
   - ✅ `bot` (required for bot functionality)
   - ✅ `applications.commands` (required for slash commands)
   - ✅ `identify` (required for OAuth user identification)
   - ✅ `guilds` (required for OAuth server access)

5. **Bot Permissions** (select these):
   - ✅ **Manage Roles** (required - core functionality)
   - ✅ **View Channels** (recommended)
   - ✅ **Send Messages** (recommended)
   - ✅ **Use Slash Commands** (required)
   - ✅ **Read Message History** (optional)

### Required Tokens & IDs
- **Bot Token**: Bot tab → Token → Copy
- **Client ID**: General Information → Application ID
- **Client Secret**: OAuth2 → General → Client Secret
- **Guild ID**: Right-click your Discord server → Copy Server ID (requires Developer Mode)

### Bot API Key (DISCORD_BOT_API_KEY)
**Source:** You create this yourself

**Purpose:** Secure authentication between web app and bot API

**Requirements:**
- Minimum 32 characters
- Use strong, random characters
- Must be identical in both `.env` files

**Generate with:**
```bash
# Option 1: OpenSSL
openssl rand -base64 32

# Option 2: Python
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Option 3: Manual (example)
crowdp-discord-bot-secure-api-key-2025
```

## 📚 Complete Documentation

This guide provides an overview of the CrowdPunk Discord Role Assignment Bot. For detailed deployment, security, and operational instructions, see:

- **[ENVIRONMENT_SETUP_GUIDE.md](./ENVIRONMENT_SETUP_GUIDE.md)** - Complete environment setup and configuration
- **[DEPLOYMENT_SECURITY_GUIDE.md](./DEPLOYMENT_SECURITY_GUIDE.md)** - Security, deployment, monitoring, and troubleshooting

### Quick Links
- [Security Configuration](#security-configuration) - Firewall and binding setup
- [Health Checks](#health-checks) - Monitoring and process management  
- [Role Configuration](#role-configuration) - Admin role management
- [Web App Deployment](#web-app-deployment) - Complete deployment instructions

## Web Application Installation & Deployment

⚠️ **For complete deployment instructions including production setup, security, monitoring, and troubleshooting, see [DEPLOYMENT_SECURITY_GUIDE.md](./DEPLOYMENT_SECURITY_GUIDE.md)**

### Development Setup (Quick Start)

**Prerequisites:**
- Node.js 18+ with npm
- Python 3.8+ with pip
- MongoDB and Redis running
- Discord Developer Application configured

**Web Application** (runs on `http://localhost:3000`):
```bash
cd web-app
npm install
npm run dev
```

**Discord Bot Service** (runs on `127.0.0.1:8001`):
```bash
cd discord-bot
pip install -r requirements.txt
python role_assignment_server.py
```

### Production Deployment Overview

1. **Environment Setup**: Configure all environment variables (see [ENVIRONMENT_SETUP_GUIDE.md](./ENVIRONMENT_SETUP_GUIDE.md))
2. **Security Configuration**: Bind services to localhost, configure firewall rules
3. **Build & Deploy**: Build web app for production, set up process management
4. **Reverse Proxy**: Configure Nginx with SSL for public access
5. **Monitoring**: Set up health checks and logging

**Key Production Commands:**
```bash
# Build web application
cd web-app && npm run build

# Start with PM2 (process management)
pm2 start npm --name "crowdp-web" -- start
pm2 start "python role_assignment_server.py" --name "crowdp-bot"

# Monitor processes
pm2 logs crowdp-web
pm2 logs crowdp-bot
```

**Health Check Endpoints:**
- Bot: `curl http://127.0.0.1:8001/health`
- Web App: `curl http://localhost:3000/` (or `/healthz`)

### Security Requirements

⚠️ **CRITICAL**: For complete security configuration, see [DEPLOYMENT_SECURITY_GUIDE.md](./DEPLOYMENT_SECURITY_GUIDE.md)

- **Localhost Binding**: Both services bind to `127.0.0.1` only
- **Firewall Protection**: Block external access to bot API port 8001
- **API Authentication**: All bot API requests require `x-api-key` header
- **No Public Bot Exposure**: Never expose port 8001 to the internet

## Role Configuration & Management

Administrators can configure role assignments and token thresholds using the <mcfile name="roles.json" path="config/roles.json"></mcfile> file:

### Role Configuration File Structure
```json
{
  "roles": {
    "osmosis_holder": {
      "role_id": "1234567890123456789",
      "name": "Osmosis Holder",
      "description": "Users holding OSMO tokens",
      "threshold": {
        "token": "OSMO",
        "minimum_amount": 100,
        "decimals": 6,
        "holding_period_hours": 24
      },
      "color": "#7C2AE8",
      "enabled": true
    }
  },
  "settings": {
    "check_interval_hours": 6,
    "grace_period_hours": 2,
    "auto_remove_roles": true,
    "log_role_changes": true
  }
}
```

### Admin Instructions for Role Updates
1. **Edit Configuration**: Modify <mcfile name="roles.json" path="config/roles.json"></mcfile> with new role settings
2. **Validate JSON**: Ensure proper JSON syntax (use online validator if needed)
3. **Restart Bot**: `pm2 restart crowdp-bot` to apply changes
4. **Monitor Logs**: `pm2 logs crowdp-bot` to verify configuration loaded successfully

⚠️ **Safety Notes**: 
- Always backup the config file before changes
- Test role IDs in Discord before adding to config
- Ensure bot role hierarchy allows assignment of target roles

## Health Checks & Process Management

### Health Check Endpoints
- **Bot Health**: `curl http://127.0.0.1:8001/health` (returns 200 OK)
- **Web App Health**: `curl http://localhost:3000/` or `/healthz` (returns 200 OK)

### Process Management with PM2
```bash
# Start processes with proper names
pm2 start npm --name "crowdp-web" -- start
pm2 start "python role_assignment_server.py" --name "crowdp-bot"

# Monitor and view logs
pm2 logs crowdp-web
pm2 logs crowdp-bot
pm2 status

# Restart processes
pm2 restart crowdp-web
pm2 restart crowdp-bot
```

For complete monitoring, alerting, and systemd alternatives, see [DEPLOYMENT_SECURITY_GUIDE.md](./DEPLOYMENT_SECURITY_GUIDE.md).

## Public Access: Cloudflare Tunnel vs Subdomain

### Why Cloudflare Tunnel Instead of Subdomain?

**Current Setup Reason:** You mentioned you don't have your own subdomain and want us to create one on crowdpunk.com

**Cloudflare Tunnel Benefits:**
- **No domain required** - provides instant public URL
- **Automatic HTTPS** - secure by default
- **No port forwarding** - works behind firewalls/NAT
- **Free tier available** - cost-effective for development

**Subdomain Setup (Recommended for Production):**
We can set up a subdomain like `verify.crowdpunk.com` or `bot.crowdpunk.com` for you:
1. **DNS Configuration:** Add A/CNAME records pointing to your VPS IP
2. **SSL Certificate:** Set up Let's Encrypt or Cloudflare SSL
3. **More Professional:** Custom domain looks better than tunnel URLs
4. **Stable URLs:** Won't change if VPS restarts

### Current Tunnel Issue: VPS Offline
**Problem:** The tunnel broke because the VPS is offline
**Solution:** 
1. **Restart VPS** - ensure it's running and accessible
2. **Restart tunnel process:**
   ```bash
   pm2 restart web-app-tunnel
   ```
3. **Check tunnel logs:**
   ```bash
   pm2 logs web-app-tunnel
   ```

**Long-term fix:** Set up a proper subdomain to avoid tunnel dependency

## How to Install the Bot in Your Discord Server

### Prerequisites:
- A Discord Application set up in the Discord Developer Portal.
- Both bot and web app deployed and running on your server with correct environment variables.
- Admin access to your Discord server.
- All required tokens and API keys obtained (see sections above).

### Steps:

#### 1. Configure the Discord Application
- Go to Discord Developer Portal → Applications → Your app.
- In "Bot" tab: Copy the Bot Token (DISCORD_BOT_TOKEN) and enable required intents:
  - **Server Members Intent: ON** (needed to fetch members and assign roles).
- In "OAuth2 → General":
  - Add Redirect URIs for the web app's callback:
    - `https://your-public-domain-or-tunnel/api/auth/discord/callback`
  - These must match exactly (protocol, host, path).

#### 2. Invite the Bot to Your Server
- In "OAuth2 → URL Generator":
  - **Scopes:** bot, applications.commands
  - **Bot Permissions:** Manage Roles (required), plus recommended: Send Messages, Read Messages/View Channels (for DMs and basic interactions).
- Copy the generated URL and visit it to invite the bot to your server.

#### 3. Prepare Your Server's Role Hierarchy
- Ensure the bot's top role is higher than all roles it needs to assign.
- If the bot's role is below a target role, Discord will prevent assignment.

#### 4. Set Up the Environment Variables (on the server)

⚠️ **IMPORTANT**: For complete environment setup instructions, security configuration, and troubleshooting, see the comprehensive **[ENVIRONMENT_SETUP_GUIDE.md](./ENVIRONMENT_SETUP_GUIDE.md)**.

## Environment Variables Quick Reference

### Discord Bot Service (.env)
```bash
# Discord Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here
DISCORD_BOT_API_KEY=your_32_char_api_key_here

# Web App Integration
WEB_APP_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=crowdpunk_discord

# Optional (recommended for production)
REDIS_URL=redis://localhost:6379
```

### Web Application (.env.local)
```bash
# Discord OAuth
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback

# Bot API Integration
DISCORD_BOT_URL=http://127.0.0.1:8001
DISCORD_BOT_API_KEY=your_32_char_api_key_here

# Database
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=crowdpunk_discord
REDIS_URL=redis://localhost:6379

# Application URLs (custom OAuth implementation)
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_NEXTAUTH_URL=http://localhost:3000

# Security
JWT_SECRET=your_jwt_secret_here
ENCRYPTION_KEY=your_32_byte_base64_encryption_key

# External APIs
OSMOSIS_API_URL=https://lcd.osmosis.zone
```

⚠️ **Critical Notes:**
- **Bot API Security**: Bot runs on `127.0.0.1:8001` (localhost only)
- **API Key Matching**: `DISCORD_BOT_API_KEY` must be identical in both files
- **NEXTAUTH_URL**: Used by custom OAuth implementation (not NextAuth library)
- **Encryption Key**: Must be 32-byte base64 string for token encryption

#### 5. Start the Services
- **Bot service:** run the role assignment API (uvicorn run, PM2 or systemd to keep it alive).
- **Web app:** run in production mode behind the Cloudflare tunnel URL.
- **Verify both with:**
  - Bot: `curl http://localhost:<bot-port>/health`
  - Web app: open `https://your-public-web-url` in the browser and test `/connect`.

#### 6. Test the Flow
- In Discord, type `/connect` and click the button.
- Complete OAuth in web app and connect wallet.
- Confirm roles are assigned automatically.

## Is This in a "Bot Store," or Private?
- This bot is **private** and purpose-built for your server. It's not listed in a public bot store.
- Anyone outside your organization cannot use it unless you invite the bot to their server and configure credentials for a multi-tenant setup.
- We can extend to multiple servers over time, but the current deployment and configuration are single-tenant and secured for your guild.

## Admin Operations and Maintenance

### Changing your public URL (e.g., new Cloudflare tunnel):
- Update `WEB_APP_URL` in the bot's .env.
- Update `NEXTAUTH_URL` and `DISCORD_REDIRECT_URI` in the web app's .env.
- Restart both services via PM2.
- Ensure the new redirect URI is added in the Discord Developer Portal.

### Monitoring:
- **Bot health:** GET /health (local).
- **Logs:** Check PM2 logs for both web app and bot service.

### Permissions:
- If role assignment fails, confirm the bot has Manage Roles and its role sits above the target roles.

## Troubleshooting Guide

### "Invalid Redirect URI" during OAuth:
- The URI in Discord Developer Portal must match exactly the web app's callback URL.
- Update `DISCORD_REDIRECT_URI` and `NEXTAUTH_URL` to your current public URL, then restart.

### Bot says "Discord bot is not ready":
- Ensure `DISCORD_BOT_TOKEN` is correct, the bot is invited, and intents are enabled.
- Give the bot a minute after restart; it syncs slash commands on startup.

### Roles not assigned:
- Check bot role hierarchy (bot's top role must be higher than target roles).
- Confirm Manage Roles permission.
- Verify the web app is calling the bot with the correct x-api-key and role IDs.

### DM not received:
- User may have DMs disabled. Role assignment still works; DM is optional.

## Next Steps & Recommendations

### Immediate Actions Needed:
1. **VPS Status:** Check if your VPS is online and accessible
2. **Subdomain Setup:** We recommend setting up `verify.crowdpunk.com` for production use
3. **Role Configuration:** Create Discord roles and note their IDs for the web app configuration
4. **Environment Variables:** Ensure all tokens and API keys are properly configured

### Production Recommendations:
- **Custom Subdomain:** Replace Cloudflare tunnel with `verify.crowdpunk.com` or similar
- **SSL Certificate:** Implement proper SSL for the custom domain
- **Redis Setup:** Ensure Redis is properly configured and running for production security
- **Monitoring:** Set up alerts for when services go down
- **Backup Strategy:** Regular backups of MongoDB data and configuration files

## Summary
- **Two-component system:** Discord bot + Web application (both run on your server)
- **Members use `/connect`** to link Discord and verify tokens via your web app
- **Admins use `/send-embed`** to broadcast the onboarding message
- **Role administration** requires creating Discord roles and configuring token thresholds
- **All tokens/keys** are obtained from Discord Developer Portal or generated by you
- **Current tunnel issue** is due to VPS being offline - needs restart
- **Subdomain setup** recommended for production stability

### Support Available:
- **Subdomain Configuration:** We can set up verify.crowdpunk.com for you
- **VPS Troubleshooting:** Help with server restart and service management  
- **Multi-tenant Version:** Can extend to multiple servers if needed
- **Additional Admin Controls:** Custom role management features available