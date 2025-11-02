import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { withRateLimit } from '@/app/lib/rate-limiter';
import { createSecureResponse, createSecureErrorResponse } from '@/lib/security-headers';
import { validateRequestBody, checkUserRequestSchema, sanitizeWalletAddress } from '@/app/lib/validation';

async function checkUserHandler(request: NextRequest) {
  try {
    const rawBody = await request.json();
    
    // Validate and sanitize input
    let validatedData;
    try {
      validatedData = validateRequestBody(checkUserRequestSchema, rawBody);
    } catch (error) {
      return createSecureErrorResponse(`Validation error: ${error instanceof Error ? error.message : 'Invalid input'}`, 400);
    }

    const { walletAddress } = validatedData;
    const sanitizedWalletAddress = sanitizeWalletAddress(walletAddress);

    const { db } = await connectToDatabase();
    const user = await db.collection('users').findOne({ walletAddress: sanitizedWalletAddress });
    
    return createSecureResponse({ exists: !!user });
  } catch (error) {
    console.error('Error checking user:', error);
    return createSecureErrorResponse('Internal server error', 500);
  }
}

// Apply rate limiting to the POST endpoint
export const POST = withRateLimit(checkUserHandler, 'default');