import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { calculateUserRole } from '@/app/lib/roles';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { validateRequestBody, saveUserRequestSchema, sanitizeWalletAddress } from '@/app/lib/validation';

async function saveUserHandler(request: NextRequest) {
  try {
    const rawBody = await request.json();
    
    // Validate and sanitize input
    let validatedData;
    try {
      validatedData = validateRequestBody(saveUserRequestSchema, rawBody);
    } catch (error) {
      return createSecureErrorResponse(`Validation error: ${error instanceof Error ? error.message : 'Invalid input'}`, 400);
    }

    const { walletAddress } = validatedData;
    const sanitizedWalletAddress = sanitizeWalletAddress(walletAddress);

    // Additional validation for Osmosis wallet address format
    if (!sanitizedWalletAddress.startsWith('osmo') || sanitizedWalletAddress.length !== 43) {
      return createSecureErrorResponse('Invalid Osmosis wallet address format', 400);
    }

    // Fetch balance directly from blockchain (server-side validation)
    let osmoBalance = 0;
    try {
      const cosmosRestUrl = process.env.COSMOS_REST_URL || 'https://lcd.testnet.osmosis.zone';
      const response = await fetch(`${cosmosRestUrl}/cosmos/bank/v1beta1/balances/${sanitizedWalletAddress}`);
      if (!response.ok) {
        throw new Error('Failed to fetch balance from blockchain');
      }
      
      const data = await response.json();
      const osmoBalanceData = data.balances?.find((b: { denom: string; amount: string }) => b.denom === 'uosmo');
      if (osmoBalanceData) {
        osmoBalance = parseInt(osmoBalanceData.amount) / 1000000; // Convert from uosmo to OSMO
      }
    } catch (error: unknown) {
      console.error('Failed to fetch balance from blockchain:', error);
      return createSecureErrorResponse('Failed to verify balance from blockchain', 500);
    }

    const { db } = await connectToDatabase();
    
    // Calculate roles based on balance
    const roleInfo = await calculateUserRole(osmoBalance);
    
    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ walletAddress: sanitizedWalletAddress });
    
    if (existingUser) {
      // Update existing user's balance and roles
      await db.collection('users').updateOne(
        { walletAddress: sanitizedWalletAddress },
        {
          $set: {
            osmoBalance,
            currentRole: roleInfo.currentRole,
            eligibleRoles: roleInfo.eligibleRoles,
            lastRoleUpdate: new Date(),
            lastBalanceUpdate: new Date()
          }
        }
      );

      // If user has Discord connected and balance is 0, trigger role removal
      if (existingUser.discordId && osmoBalance === 0 && existingUser.osmoBalance > 0) {
        try {
          // Call Discord bot API to remove all token-based roles
          const discordBotUrl = process.env.DISCORD_BOT_URL || 'http://localhost:8000';
          const response = await fetch(`${discordBotUrl}/assign-permanent-roles`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.DISCORD_BOT_API_KEY || '',
            },
            body: JSON.stringify({
              discord_id: existingUser.discordId,
              role_ids: [], // Empty array means remove all token-based roles
              wallet_address: existingUser.walletAddress
            }),
          });

          if (response.ok) {
            console.log(`Successfully removed roles for user ${existingUser.discordUsername} (balance: ${osmoBalance})`);
          } else {
            console.error(`Failed to remove roles for user ${existingUser.discordUsername}:`, await response.text());
          }
        } catch (error: unknown) {
          console.error('Error calling Discord bot for role removal:', error);
        }
      }
    } else {
      // Create new user
      await db.collection('users').insertOne({
        walletAddress: sanitizedWalletAddress,
        osmoBalance,
        currentRole: roleInfo.currentRole,
        eligibleRoles: roleInfo.eligibleRoles,
        createdAt: new Date(),
        lastRoleUpdate: new Date(),
        lastBalanceUpdate: new Date(),
        // Discord fields will be null until OAuth
        discordId: null,
        discordUsername: null,
        discordDiscriminator: null,
        discordAvatar: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        connectedAt: null,
        assignedDiscordRoles: []
      });
    }

    return createSecureResponse({
      success: true,
      message: 'User saved successfully',
      user: {
        walletAddress: sanitizedWalletAddress,
        osmoBalance,
        ...roleInfo
      }
    });
  } catch (error: unknown) {
    console.error('Error saving user:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(saveUserHandler, 'userUpdate');