import { NextRequest } from 'next/server';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { validateRequestBody, testRoleRequestSchema, sanitizeWalletAddress } from '@/app/lib/validation';

async function testRoleHandler(request: NextRequest) {
  try {
    // Verify admin access for test role assignment
    const { verifyAdminAccess } = await import('@/app/lib/auth');
    const authResult = await verifyAdminAccess(request);
    
    if (!authResult.success) {
      return createSecureErrorResponse(authResult.error || 'Unauthorized - Admin access required', 401);
    }

    const rawBody = await request.json();
    
    // Validate and sanitize input
    let validatedData;
    try {
      validatedData = validateRequestBody(testRoleRequestSchema, rawBody);
    } catch (error) {
      return createSecureErrorResponse(`Validation error: ${error instanceof Error ? error.message : 'Invalid input'}`, 400);
    }

    const { walletAddress, roleId } = validatedData;
    const sanitizedWalletAddress = sanitizeWalletAddress(walletAddress);

    // Use environment variable for Discord bot URL
    const discordBotUrl = process.env.DISCORD_BOT_URL || 'http://localhost:8000';
    
    // Call Discord bot to assign the test role
    const discordResponse = await fetch(`${discordBotUrl}/assign-test-role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.DISCORD_BOT_API_KEY || '', // Add API key for bot authentication
      },
      body: JSON.stringify({
        wallet_address: sanitizedWalletAddress,
        role_id: roleId
      }),
    });

    if (!discordResponse.ok) {
      const errorData = await discordResponse.json();
      return createSecureErrorResponse(errorData.detail || 'Failed to assign test role', discordResponse.status);
    }

    const result = await discordResponse.json();
    return createSecureResponse(result);

  } catch (error) {
    console.error('Error in test-role API:', error);
    return createSecureResponse({ message: 'Internal server error' }, 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(testRoleHandler, 'default');