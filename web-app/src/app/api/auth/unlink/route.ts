import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { verifyUserSession } from '@/app/lib/auth';

async function unlinkHandler(request: NextRequest) {
  try {
    // Verify user session
    const authResult = await verifyUserSession(request);
    if (!authResult.success || !authResult.user) {
      return createSecureErrorResponse('Authentication required', 401);
    }

    const { walletAddress, discordId } = authResult.user;
    const { db } = await connectToDatabase();

    // Find the user to unlink
    const user = await db.collection('users').findOne({ 
      walletAddress,
      discordId 
    });

    if (!user) {
      return createSecureErrorResponse('User not found or already unlinked', 404);
    }

    // Remove Discord-related fields but keep wallet data
    await db.collection('users').updateOne(
      { walletAddress },
      {
        $unset: {
          discordId: "",
          discordUsername: "",
          discordDiscriminator: "",
          discordAvatar: "",
          encryptedAccessToken: "",
          encryptedRefreshToken: "",
          currentRole: "",
          eligibleRoles: "",
          lastRoleUpdate: ""
        },
        $set: {
          unlinkedAt: new Date()
        }
      }
    );

    // Remove all Discord roles from the user
    try {
      const discordBotUrl = process.env.DISCORD_BOT_URL || 'http://localhost:8000';
      const apiKey = process.env.DISCORD_BOT_API_KEY;
      
      if (apiKey) {
        const response = await fetch(`${discordBotUrl}/assign-permanent-roles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          },
          body: JSON.stringify({
            discord_id: discordId,
            role_ids: [], // Empty array removes all token-based roles
            wallet_address: walletAddress
          }),
        });

        if (!response.ok) {
          console.error('Failed to remove Discord roles during unlink:', response.status);
        }
      }
    } catch (error) {
      console.error('Error removing Discord roles during unlink:', error);
      // Don't fail the unlink operation if role removal fails
    }

    // Invalidate all user sessions
    await db.collection('user_sessions').updateMany(
      { walletAddress },
      { $set: { active: false } }
    );

    return createSecureResponse({
      success: true,
      message: 'Discord account successfully unlinked from wallet'
    });

  } catch (error) {
    console.error('Error unlinking Discord account:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(unlinkHandler, 'auth');
