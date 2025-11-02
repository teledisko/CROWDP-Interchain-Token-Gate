import { NextRequest } from 'next/server';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { createWalletSession } from '@/app/lib/session-manager';
import { validateRequestBody, sessionRequestSchema, sanitizeWalletAddress } from '@/app/lib/validation';

async function createSessionHandler(request: NextRequest) {
  try {
    const rawBody = await request.json();
    
    // Validate and sanitize input
    let validatedData;
    try {
      validatedData = validateRequestBody(sessionRequestSchema, rawBody);
    } catch (error) {
      return createSecureErrorResponse(`Validation error: ${error instanceof Error ? error.message : 'Invalid input'}`, 400);
    }

    const { walletAddress } = validatedData;
    const sanitizedWalletAddress = sanitizeWalletAddress(walletAddress);

    // Get client info for session tracking
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Create secure session directly with wallet address
    const sessionId = await createWalletSession(sanitizedWalletAddress, ipAddress, userAgent);

    return createSecureResponse({
      success: true,
      sessionId,
      message: 'Session created successfully'
    });
  } catch (error) {
    console.error('Error creating session:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(createSessionHandler, 'auth');
