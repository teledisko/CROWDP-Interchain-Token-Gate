# CrowdPunk Token Verifier - Web Application

A Next.js web application that enables Discord users to verify their Cosmos ecosystem token holdings and receive appropriate Discord roles based on their token balances.

## Features

- **Discord OAuth Integration** - Secure authentication with Discord
- **Wallet Connection** - Support for Cosmos ecosystem wallets
- **Token Verification** - Real-time balance checking across Cosmos chains
- **Role Assignment** - Automatic Discord role assignment based on token holdings
- **Anti-Gaming Protection** - Advanced heuristics to prevent role manipulation

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Discord application with OAuth configured
- MongoDB database
- Redis instance (for session management)

### Installation

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env.local` and configure your environment variables:
   ```env
   DISCORD_CLIENT_ID=your_discord_client_id
   DISCORD_CLIENT_SECRET=your_discord_client_secret
   MONGODB_URI=your_mongodb_connection_string
   REDIS_URL=your_redis_connection_string
   ```

3. **Run Development Server:**
   ```bash
   npm run dev
   ```

4. **Open Application:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Architecture

- **Frontend**: Next.js 14 with App Router
- **Authentication**: Discord OAuth 2.0
- **Database**: MongoDB for user data and balance history
- **Session Management**: Redis for secure session storage
- **Styling**: Tailwind CSS with custom components

## Security Features

- Secure session management with httpOnly cookies
- CSRF protection for OAuth flows
- Rate limiting on API endpoints
- Input validation and sanitization
- Anti-gaming heuristics for role assignment
