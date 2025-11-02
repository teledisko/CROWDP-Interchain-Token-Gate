# CrowdPunk Token Verifier - Discord Bot

A Discord bot that verifies Cosmos ecosystem token holdings and assigns roles based on token ownership. The bot integrates with a web application to provide a seamless user experience for wallet verification and role assignment.

## Features

- **Role Assignment** - Automatic Discord role assignment based on verified token holdings
- **Anti-Gaming Protection** - Advanced heuristics to prevent role manipulation and gaming
- **Admin Commands** - Administrative tools for server management
- **User Commands** - Simple commands for users to connect and verify their wallets
- **Balance Monitoring** - Continuous monitoring of user token balances with automatic role updates

## Commands

### Admin Commands

#### `/send-embed`
**Admin Only** - Send a custom embed to a specified channel

**Parameters:**
- `channel` - The channel to send the embed to
- `title` - Title of the embed
- `description` - Description/content of the embed
- `color` - Hex color code (optional, e.g., #ff0000)

### User Commands

#### `/connect`
**All Users** - Get your personalized connection link

This command provides users with:
1. A personalized embed with instructions
2. A button that redirects to the web application
3. Integration with the web app for wallet connection and verification

## Setup

### Prerequisites
- Python 3.8+
- Discord Bot Token
- MongoDB database
- Web application component (for complete functionality)

### Installation

1. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure Environment:**
   Create a `.env` file with the following variables:
   ```env
   DISCORD_BOT_TOKEN=your_discord_bot_token
   DISCORD_GUILD_ID=your_discord_server_id
   WEB_APP_URL=your_web_app_url
   MONGODB_URI=your_mongodb_connection_string
   DISCORD_BOT_API_KEY=your_secure_api_key
   ```

3. **Run the Bot:**
   ```bash
   python bot.py
   ```

## Architecture

The bot consists of several components:

- **bot.py** - Main Discord bot with slash commands
- **role_assignment_server.py** - FastAPI server for role assignment API
- **balance_monitor.py** - Background service for monitoring token balances
- **anti_gaming_heuristics.py** - Anti-gaming protection system
- **database.py** - Database connection and utilities

## Anti-Gaming Features

- **Wallet Age Validation** - Blocks wallets younger than configurable threshold
- **Balance Volatility Detection** - Detects suspicious balance changes
- **Audit Trail** - Comprehensive logging of all blocked assignments
- **Configurable Thresholds** - Environment-based configuration for all limits

## API Endpoints

The bot exposes a secure API for integration with the web application:

- **POST /assign-permanent-roles** - Assign Discord roles after token verification
- **GET /health** - Health check endpoint

All API endpoints require authentication via API key.

1. User runs `/connect` command
2. Bot sends personalized embed with connect button
3. User clicks button and is redirected to web application
4. User connects their Cosmos wallet on the website
5. User links their Discord account
6. System verifies token holdings across multiple chains
7. User receives appropriate roles based on holdings
8. User is redirected back to Discord server

## Security Features

- Admin-only commands with permission checks
- Ephemeral responses for sensitive operations
- Secure token handling
- Environment variable configuration

## Future Enhancements

- Multi-chain token verification
- Automatic role assignment
- Token holding thresholds
- Real-time balance monitoring
- Integration with Cosmos ecosystem APIs

## Environment Variables

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
WEB_APP_URL=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/verifier-db
COSMOS_CHAIN_ID=cosmoshub-4
COSMOS_RPC_URL=https://cosmos-rpc.quickapi.com
JWT_SECRET=your-jwt-secret-key-here
```

## Requirements

- Python 3.8+
- Discord.py 2.3.2+
- Active Discord Bot Token
- Web application for wallet connection