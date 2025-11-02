import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { verifyUserSession } from '@/app/lib/auth';

async function getUserInfoHandler(request: NextRequest) {
  try {
    // Verify the session using the request object
    const sessionResult = await verifyUserSession(request);
    
    if (!sessionResult.success || !sessionResult.user) {
      return createSecureErrorResponse('Invalid or expired session', 401);
    }

    const { db } = await connectToDatabase();
    
    // Get the most up-to-date user information
    const user = await db.collection('users').findOne({ 
      walletAddress: sessionResult.user.walletAddress 
    });
    
    if (!user) {
      return createSecureErrorResponse('User not found', 404);
    }

    // Return user information (excluding sensitive data)
    return createSecureResponse({
      success: true,
      walletAddress: user.walletAddress,
      discordId: user.discordId,
      discordUsername: user.discordUsername,
      discordDiscriminator: user.discordDiscriminator,
      discordAvatar: user.discordAvatar,
      verified: user.verified,
      lastLogin: user.lastLogin,
      osmoBalance: user.osmoBalance || 0
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the GET endpoint
export const GET = withRateLimit(getUserInfoHandler, 'default');