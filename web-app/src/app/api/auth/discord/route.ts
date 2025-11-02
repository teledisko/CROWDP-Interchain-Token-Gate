import { NextRequest } from 'next/server';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { getSessionInfo } from '@/app/lib/session-manager';
import { randomBytes, createHash } from 'crypto';
import { connectToDatabase } from '@/app/lib/mongodb';

async function discordAuthHandler(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    
    if (!sessionId) {
      return createSecureErrorResponse('Session ID is required', 400);
    }

    // Validate session and get wallet address
    const sessionResult = await getSessionInfo(sessionId);
    if (!sessionResult.success || !sessionResult.walletAddress) {
      return createSecureErrorResponse('Invalid or expired session', 401);
    }

    const walletAddress = sessionResult.walletAddress;
    const { db } = await connectToDatabase();

    // Generate cryptographically secure state for CSRF protection
    const state = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    console.log('OAuth Debug - state:', state);

    // Store state in database linked to session (NO wallet address in URL)
    const insertResult = await db.collection('oauth_states').insertOne({
      state,
      sessionId,
      walletAddress, // Stored securely in database only
      expiresAt,
      createdAt: new Date(),
      used: false
    });
    
    console.log('State inserted into database:', insertResult.acknowledged ? 'SUCCESS' : 'FAILED');

    // Clean up expired states
    await db.collection('oauth_states').deleteMany({
      expiresAt: { $lt: new Date() }
    });

    // Generate Discord OAuth URL (standard flow)
    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/discord/callback`);
    
    // SECURE: Only state token in URL, wallet address stays in database
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${discordClientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify+guilds&state=${state}`;

    return createSecureResponse({
      success: true,
      discordAuthUrl
    });
  } catch (error) {
    console.error('Error creating Discord auth URL:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(discordAuthHandler, 'auth');