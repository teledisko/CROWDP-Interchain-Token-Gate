import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { RoleDatabase } from '@/app/lib/database';

async function getRolesHandler(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    // If no wallet parameter provided, return all roles for goals display
    if (!wallet) {
      const allRoles = await RoleDatabase.getAllRoles();
      return NextResponse.json({
        roles: allRoles.map(role => ({
          name: role.name,
          type: role.type,
          threshold: role.amountThreshold || 0,
          description: role.description || (role.type === 'amount' 
            ? `Member with ${role.amountThreshold}+ OSMO tokens` 
            : `Holder of ${role.name} tokens`)
        }))
      });
    }

    // Fetch balance server-side from blockchain instead of accepting client-supplied balance
    let osmoBalance = 0;
    try {
      const cosmosRestUrl = process.env.COSMOS_REST_URL || 'https://lcd.testnet.osmosis.zone';
      const response = await fetch(`${cosmosRestUrl}/cosmos/bank/v1beta1/balances/${wallet}`);
      const data = await response.json();
      
      const osmoBalanceData = data.balances?.find((b: { denom: string; amount: string }) => b.denom === 'uosmo');
      if (osmoBalanceData) {
        osmoBalance = parseInt(osmoBalanceData.amount) / 1000000; // Convert from uosmo to OSMO
      }
    } catch (error) {
      console.error('Failed to fetch balance from blockchain:', error);
      return createSecureErrorResponse('Failed to verify balance from blockchain', 500);
    }

    // Get roles that the user qualifies for based on their server-verified balance
    const qualifiedRoles = await RoleDatabase.getRoleForBalance(osmoBalance);

    // Calculate user role based on qualified roles
    let userRole = 'No Role';
    let roleGoals: string[] = [];

    if (qualifiedRoles.length > 0) {
      // Find the highest threshold role they qualify for
      const amountRoles = qualifiedRoles.filter(role => role.type === 'amount');
      const holderRoles = qualifiedRoles.filter(role => role.type === 'holder');

      if (amountRoles.length > 0) {
        // Get the role with the highest threshold they qualify for
        const highestRole = amountRoles.reduce((prev, current) => 
          (current.amountThreshold || 0) > (prev.amountThreshold || 0) ? current : prev
        );
        userRole = highestRole.name;
      } else if (holderRoles.length > 0) {
        // If they only qualify for holder roles, use the first one
        userRole = holderRoles[0].name;
      }
    }

    // Get all roles to show goals
    const allRoles = await RoleDatabase.getAllRoles();
    roleGoals = allRoles
      .filter(role => role.type === 'amount' && (role.amountThreshold || 0) > osmoBalance)
      .sort((a, b) => (a.amountThreshold || 0) - (b.amountThreshold || 0))
      .map(role => `${role.name}: ${role.amountThreshold} OSMO`);

    return NextResponse.json({
      user: userRole,
      goals: roleGoals,
      qualifiedRoles: qualifiedRoles.map(role => ({
        name: role.name,
        type: role.type,
        threshold: role.amountThreshold
      }))
    });

  } catch (error) {
    console.error('Error fetching roles:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the GET endpoint
export const GET = withRateLimit(getRolesHandler, 'default');

async function createRoleHandler(request: NextRequest) {
  try {
    // Verify admin access for role creation
    const { verifyAdminAccess } = await import('@/app/lib/auth');
    const authResult = await verifyAdminAccess(request);
    
    if (!authResult.success) {
      return createSecureErrorResponse(authResult.error || 'Unauthorized', 401);
    }

    const { name, discordRoleId, amountThreshold, type } = await request.json();

    if (!name || !discordRoleId || !type) {
      return createSecureErrorResponse('Name, discordRoleId, and type are required' , 400);
    }

    if (type !== 'holder' && type !== 'amount') {
      return createSecureErrorResponse('Type must be either "holder" or "amount"', 400);
    }

    if (type === 'amount' && (!amountThreshold || amountThreshold <= 0)) {
      return createSecureErrorResponse('Amount threshold is required for amount-based roles and must be greater than 0', 400);
    }

    const roleData = {
      name,
      discordRoleId,
      type: type as 'holder' | 'amount',
      ...(type === 'amount' && { amountThreshold })
    };

    const newRole = await RoleDatabase.addRole(roleData);

    return createSecureResponse({
      success: true,
      role: newRole
    });

  } catch (error) {
    console.error('Error adding role:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(createRoleHandler, 'default');