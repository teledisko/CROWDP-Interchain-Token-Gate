import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { calculateUserRole } from '@/app/lib/roles';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { verifyUserSession } from '@/app/lib/auth';

async function assignRolesHandler(request: NextRequest) {
  try {
    // Verify user session first
    const sessionResult = await verifyUserSession(request);
    
    if (!sessionResult.success || !sessionResult.user) {
      return createSecureErrorResponse('Authentication required', 401);
    }

    const { walletAddress } = await request.json();
    
    // Use wallet address from session if not provided in request
    const targetWalletAddress = walletAddress || sessionResult.user.walletAddress;
    
    if (!targetWalletAddress) {
      return createSecureErrorResponse('Wallet address is required', 400);
    }

    // Validate wallet address format
    if (!targetWalletAddress.startsWith('osmo') || targetWalletAddress.length !== 43) {
      return createSecureErrorResponse('Invalid Osmosis wallet address format', 400);
    }

    const { db } = await connectToDatabase();
    
    // Find user in database
    const user = await db.collection('users').findOne({ walletAddress: targetWalletAddress });
    
    if (!user || !user.discordId) {
      return createSecureErrorResponse('User not found or Discord not connected', 404);
    }

    // Fetch current balance from blockchain (server-side validation)
    let osmoBalance = 0;
    try {
      const cosmosRestUrl = process.env.COSMOS_REST_URL || 'https://lcd.testnet.osmosis.zone';
      const response = await fetch(`${cosmosRestUrl}/cosmos/bank/v1beta1/balances/${targetWalletAddress}`);
      if (!response.ok) {
        throw new Error('Failed to fetch balance from blockchain');
      }
      
      const data = await response.json();
      const osmoBalanceData = data.balances?.find((b: { denom: string; amount: string }) => b.denom === 'uosmo');
      if (osmoBalanceData) {
        osmoBalance = parseInt(osmoBalanceData.amount) / 1000000;
      }
    } catch (error) {
      console.error('Failed to fetch balance from blockchain:', error);
      return createSecureErrorResponse('Failed to verify balance from blockchain', 500);
    }

    // Calculate role information based on server-verified balance
    const roleInfo = await calculateUserRole(osmoBalance);
    
    // Get all roles from database to match with Discord role IDs
    const rolesCollection = db.collection('roles');
    const allRoles = await rolesCollection.find({}).toArray();
    
    // Find Discord role IDs for eligible roles
    const eligibleDiscordRoles = [];
    for (const eligibleRoleName of roleInfo.eligibleRoles) {
      const dbRole = allRoles.find(role => 
        role.name.toLowerCase() === eligibleRoleName.toLowerCase()
      );
      if (dbRole && dbRole.discordRoleId) {
        eligibleDiscordRoles.push(dbRole.discordRoleId);
      }
    }

    // Call Discord bot API to assign roles
    if (eligibleDiscordRoles.length > 0) {
      try {
        const discordBotUrl = process.env.DISCORD_BOT_URL || 'http://localhost:8001';
        
        const response = await fetch(`${discordBotUrl}/assign-permanent-roles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.DISCORD_BOT_API_KEY || '',
          },
          body: JSON.stringify({
            discord_id: user.discordId,
            role_ids: eligibleDiscordRoles,
            wallet_address: targetWalletAddress
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to assign Discord roles');
        }

        const result = await response.json();
        
        // Update user's role information in database
        await db.collection('users').updateOne(
          { walletAddress: targetWalletAddress },
          {
            $set: {
              osmoBalance,
              currentRole: roleInfo.currentRole,
              eligibleRoles: roleInfo.eligibleRoles,
              lastRoleUpdate: new Date(),
              assignedDiscordRoles: eligibleDiscordRoles
            }
          }
        );

        return createSecureResponse({
          success: true,
          message: 'Roles assigned successfully',
          assignedRoles: result.assigned_roles || eligibleDiscordRoles,
          roleInfo
        });

      } catch (error) {
        console.error('Error assigning Discord roles:', error);
        
        // Still update database even if Discord assignment fails
        await db.collection('users').updateOne(
          { walletAddress: targetWalletAddress },
          {
            $set: {
              osmoBalance,
              currentRole: roleInfo.currentRole,
              eligibleRoles: roleInfo.eligibleRoles,
              lastRoleUpdate: new Date()
            }
          }
        );

        return NextResponse.json({
          success: false,
          error: 'Failed to assign Discord roles: ' + (error instanceof Error ? error.message : String(error)),
          roleInfo
        }, { status: 500 });
      }
    } else {
      // No eligible roles found
      await db.collection('users').updateOne(
        { walletAddress: targetWalletAddress },
        {
          $set: {
            osmoBalance,
            currentRole: roleInfo.currentRole,
            eligibleRoles: roleInfo.eligibleRoles,
            lastRoleUpdate: new Date(),
            assignedDiscordRoles: []
          }
        }
      );

      return createSecureResponse({
        success: true,
        message: 'No eligible roles found for current balance',
        assignedRoles: [],
        roleInfo
      });
    }

  } catch (error) {
    console.error('Error in role assignment API:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(assignRolesHandler, 'roleAssignment');