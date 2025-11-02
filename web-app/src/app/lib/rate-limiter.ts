import { NextRequest, NextResponse } from 'next/server';
import { redisRateLimit, isRedisAvailable } from './redis-client';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting (fallback when Redis is unavailable)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Rate limit configurations
export const RATE_LIMITS = {
  // General API endpoints
  default: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100, // 100 requests per 15 minutes
  },
  // Authentication endpoints (more restrictive)
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 requests per 15 minutes
  },
  // Role assignment endpoints (reasonable for development)
  roleAssignment: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 50, // 50 requests per 15 minutes
  },
  // User save/update endpoints
  userUpdate: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 20, // 20 requests per 5 minutes
  }
};

/**
 * Get client identifier for rate limiting
 */
function getClientId(request: NextRequest): string {
  // Try to get IP address from various headers
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  
  const ip = forwarded?.split(',')[0] || realIp || cfConnectingIp || 'unknown';
  
  // For authenticated requests, also include user identifier if available
  const userAgent = request.headers.get('user-agent') || '';
  
  return `${ip}:${userAgent.slice(0, 50)}`; // Limit user agent length
}

/**
 * Clean up expired entries from rate limit store (in-memory fallback)
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * In-memory rate limiting (fallback)
 */
function inMemoryRateLimit(clientId: string, config: { windowMs: number; maxRequests: number }): NextResponse | null {
  // Clean up expired entries periodically
  if (Math.random() < 0.01) { // 1% chance to cleanup
    cleanupExpiredEntries();
  }

  const now = Date.now();
  let entry = rateLimitStore.get(clientId);

  if (!entry || now > entry.resetTime) {
    // Create new entry or reset expired entry
    entry = {
      count: 1,
      resetTime: now + config.windowMs
    };
    rateLimitStore.set(clientId, entry);
    return null; // Allow request
  }

  if (entry.count >= config.maxRequests) {
    // Rate limit exceeded
    const resetTimeSeconds = Math.ceil((entry.resetTime - now) / 1000);
    
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Too many requests. Try again in ${resetTimeSeconds} seconds.`,
        retryAfter: resetTimeSeconds
      },
      {
        status: 429,
        headers: {
          'Retry-After': resetTimeSeconds.toString(),
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': entry.resetTime.toString()
        }
      }
    );
  }

  // Increment counter
  entry.count++;
  rateLimitStore.set(clientId, entry);

  return null; // Allow request
}

/**
 * Rate limiting middleware with Redis support and in-memory fallback (development only)
 */
export function rateLimit(config: { windowMs: number; maxRequests: number }) {
  return async (request: NextRequest): Promise<NextResponse | null> => {
    const clientId = getClientId(request);
    
    try {
      // Try Redis-based rate limiting first
      if (await isRedisAvailable()) {
        const rateLimitKey = `rate_limit:${clientId}`;
        const result = await redisRateLimit(rateLimitKey, config.windowMs, config.maxRequests);
        
        if (!result.allowed) {
          const resetTimeSeconds = Math.ceil((result.resetTime - Date.now()) / 1000);
          
          return NextResponse.json(
            {
              error: 'Rate limit exceeded',
              message: `Too many requests. Try again in ${resetTimeSeconds} seconds.`,
              retryAfter: resetTimeSeconds
            },
            {
              status: 429,
              headers: {
                'Retry-After': resetTimeSeconds.toString(),
                'X-RateLimit-Limit': config.maxRequests.toString(),
                'X-RateLimit-Remaining': result.remaining.toString(),
                'X-RateLimit-Reset': result.resetTime.toString()
              }
            }
          );
        }
        
        return null; // Allow request
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.error('CRITICAL: Redis rate limiting failed in production:', error);
        // In production, fail the request if Redis is unavailable
        return NextResponse.json(
          {
            error: 'Service temporarily unavailable',
            message: 'Rate limiting service is unavailable. Please try again later.'
          },
          { status: 503 }
        );
      }
      console.warn('Redis rate limiting failed, falling back to in-memory:', error);
    }
    
    // Fall back to in-memory rate limiting (development only)
    if (process.env.NODE_ENV === 'production') {
      console.error('CRITICAL: Attempting to use in-memory rate limiting in production');
      return NextResponse.json(
        {
          error: 'Service temporarily unavailable',
          message: 'Rate limiting service is unavailable. Please try again later.'
        },
        { status: 503 }
      );
    }
    
    return inMemoryRateLimit(clientId, config);
  };
}

/**
 * Apply rate limiting to an API route
 */
export function withRateLimit(
  handler: (request: NextRequest) => Promise<NextResponse>,
  limitType: keyof typeof RATE_LIMITS = 'default'
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const rateLimitResponse = await rateLimit(RATE_LIMITS[limitType])(request);
    
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    return handler(request);
  };
}

/**
 * Rate limit by IP and optional user identifier
 */
export async function rateLimitByIpAndUser(
  request: NextRequest,
  config: { windowMs: number; maxRequests: number },
  userId?: string
): Promise<NextResponse | null> {
  const baseClientId = getClientId(request);
  const clientId = userId ? `${baseClientId}:user:${userId}` : baseClientId;
  
  try {
    // Try Redis-based rate limiting first
    if (await isRedisAvailable()) {
      const rateLimitKey = `rate_limit:${clientId}`;
      const result = await redisRateLimit(rateLimitKey, config.windowMs, config.maxRequests);
      
      if (!result.allowed) {
        const resetTimeSeconds = Math.ceil((result.resetTime - Date.now()) / 1000);
        
        return NextResponse.json(
          {
            error: 'Rate limit exceeded',
            message: `Too many requests. Try again in ${resetTimeSeconds} seconds.`,
            retryAfter: resetTimeSeconds
          },
          {
            status: 429,
            headers: {
              'Retry-After': resetTimeSeconds.toString(),
              'X-RateLimit-Limit': config.maxRequests.toString(),
              'X-RateLimit-Remaining': result.remaining.toString(),
              'X-RateLimit-Reset': result.resetTime.toString()
            }
          }
        );
      }
      
      return null; // Allow request
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.error('CRITICAL: Redis rate limiting failed in production:', error);
      // In production, fail the request if Redis is unavailable
      return NextResponse.json(
        {
          error: 'Service temporarily unavailable',
          message: 'Rate limiting service is unavailable. Please try again later.'
        },
        { status: 503 }
      );
    }
    console.warn('Redis rate limiting failed, falling back to in-memory:', error);
  }
  
  // Fall back to in-memory rate limiting (development only)
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL: Attempting to use in-memory rate limiting in production');
    return NextResponse.json(
      {
        error: 'Service temporarily unavailable',
        message: 'Rate limiting service is unavailable. Please try again later.'
      },
      { status: 503 }
    );
  }
  
  const now = Date.now();
  let entry = rateLimitStore.get(clientId);

  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs
    };
    rateLimitStore.set(clientId, entry);
    return null;
  }

  if (entry.count >= config.maxRequests) {
    const resetTimeSeconds = Math.ceil((entry.resetTime - now) / 1000);
    
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Too many requests. Try again in ${resetTimeSeconds} seconds.`,
        retryAfter: resetTimeSeconds
      },
      {
        status: 429,
        headers: {
          'Retry-After': resetTimeSeconds.toString(),
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': entry.resetTime.toString()
        }
      }
    );
  }

  entry.count++;
  rateLimitStore.set(clientId, entry);
  return null;
}