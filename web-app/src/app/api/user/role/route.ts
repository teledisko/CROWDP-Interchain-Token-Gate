import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { calculateUserRole, getAllRoleGoals } from '@/app/lib/roles';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';

async function getUserRoleHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('wallet');
    const discordId = searchParams.get('discord');
    const action = searchParams.get('action') || 'check';

    // Handle different actions
    switch (action) {
      case 'goals':
        // Return all role goals
        return createSecureResponse({
          success: true,
          roles: await getAllRoleGoals()
        });

      case 'check':
        // Check specific user's role
        if (!walletAddress && !discordId) {
          return createSecureErrorResponse('Either wallet address or Discord ID is required', 400);
        }

        const { db } = await connectToDatabase();
        
        // Find user by wallet address or Discord ID
        const query = walletAddress 
          ? { walletAddress }
          : { discordId };
        
        const user = await db.collection('users').findOne(query);
        
        if (!user) {
          return createSecureErrorResponse('User not found', 404);
        }

        // Get current OSMO balance (this would typically come from blockchain query)
        // For now, we'll use stored balance or default to 0
        let osmoBalance = user.osmoBalance || 0;

        // If we have a wallet address, try to fetch current balance from blockchain
        const userWalletAddress = user.walletAddress;
        if (userWalletAddress) {
          try {
            const cosmosRestUrl = process.env.COSMOS_REST_URL || 'https://lcd.testnet.osmosis.zone';
            const response = await fetch(`${cosmosRestUrl}/cosmos/bank/v1beta1/balances/${userWalletAddress}`);
            if (!response.ok) {
              throw new Error('Failed to fetch balance from blockchain');
            }
            const data = await response.json();
            
            // Find OSMO balance (uosmo denomination)
            const osmoBalanceData = data.balances?.find((balance: { denom: string; amount: string }) => 
              balance.denom === 'uosmo'
            );
            
            if (osmoBalanceData) {
              // Convert from uosmo to OSMO (divide by 1,000,000)
              osmoBalance = parseFloat(osmoBalanceData.amount) / 1000000;
              
              // Update stored balance
              await db.collection('users').updateOne(
                { _id: user._id },
                { $set: { osmoBalance } }
              );
            }
          } catch (error) {
            console.error('Error fetching balance from blockchain:', error);
            // Continue with stored balance
          }
        }

        // Calculate user's role based on balance
         const roleInfo = await calculateUserRole(osmoBalance);

        return createSecureResponse({
          success: true,
          user: {
            walletAddress: user.walletAddress,
            discordId: user.discordId,
            discordUsername: user.discordUsername,
            osmoBalance,
            ...roleInfo
          }
        });

      default:
        return createSecureErrorResponse('Invalid action. Use "check" or "goals"', 400);
    }
  } catch (error) {
    console.error('Error in GET /api/user/role:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

async function updateUserRoleHandler(request: NextRequest) {
  try {
    const { walletAddress, discordId } = await request.json();
    
    if (!walletAddress && !discordId) {
      return createSecureErrorResponse('Either wallet address or Discord ID is required', 400);
    }

    const { db } = await connectToDatabase();
    
    // Find user by wallet address or Discord ID
    const query = walletAddress 
      ? { walletAddress }
      : { discordId };
    
    const user = await db.collection('users').findOne(query);
    
    if (!user) {
      return createSecureErrorResponse('User not found', 404);
    }

    // Get current OSMO balance from blockchain
    let osmoBalance = 0;
    const userWalletAddress = user.walletAddress;
    
    if (userWalletAddress) {
      try {
        const response = await fetch(`https://lcd.testnet.osmosis.zone/cosmos/bank/v1beta1/balances/${userWalletAddress}`);
        if (!response.ok) {
          throw new Error('Failed to fetch balance from blockchain');
        }
        const data = await response.json();
        
        // Find OSMO balance (uosmo denomination)
        const osmoBalanceData = data.balances?.find((balance: { denom: string; amount: string }) => 
          balance.denom === 'uosmo'
        );
        
        if (osmoBalanceData) {
          // Convert from uosmo to OSMO (divide by 1,000,000)
          osmoBalance = parseFloat(osmoBalanceData.amount) / 1000000;
        }
      } catch (error) {
        console.error('Error fetching balance from blockchain:', error);
        // Use stored balance as fallback
        osmoBalance = user.osmoBalance || 0;
      }
    }

    // Calculate user's role based on balance
     const roleInfo = await calculateUserRole(osmoBalance);

     // Update user's balance and role info in database
     await db.collection('users').updateOne(
       { _id: user._id },
       { 
         $set: { 
           osmoBalance,
           lastRoleCheck: new Date(),
           currentRole: roleInfo.currentRole,
           nextRole: roleInfo.nextRole?.name || null
         } 
       }
     );

     // Call Discord bot to update roles
     if (user.discordId) {
       try {
         const discordBotUrl = process.env.DISCORD_BOT_URL || 'http://localhost:8000';
         const discordResponse = await fetch(`${discordBotUrl}/update-user-roles`, {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'x-api-key': process.env.DISCORD_BOT_API_KEY || '',
           },
           body: JSON.stringify({
             discordId: user.discordId,
             walletAddress: user.walletAddress,
             osmoBalance,
             role: roleInfo.currentRole,
             nextRole: roleInfo.nextRole?.name || null
           }),
         });

        if (!discordResponse.ok) {
          console.error('Failed to update Discord roles:', await discordResponse.text());
        }
      } catch (error) {
        console.error('Error calling Discord bot:', error);
      }
    }

    return createSecureResponse({
      success: true,
      message: 'User role updated successfully',
      user: {
        walletAddress: user.walletAddress,
        discordId: user.discordId,
        discordUsername: user.discordUsername,
        osmoBalance,
        ...roleInfo
      }
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the endpoints
export const GET = withRateLimit(getUserRoleHandler, 'default');
export const POST = withRateLimit(updateUserRoleHandler, 'default');
