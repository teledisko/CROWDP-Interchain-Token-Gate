import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { createUserSession } from '@/app/lib/auth';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI!;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    console.log('Callback received - state:', state);

    const { db } = await connectToDatabase();

    // Find and validate state
    console.log('Looking for state in database:', state);
    const stateDoc = await db.collection('oauth_states').findOne({ state, used: false });
    console.log('State document found:', stateDoc ? 'YES' : 'NO');
    
    if (!stateDoc) {
      // Check if any state document exists (for debugging)
      const anyStateDoc = await db.collection('oauth_states').findOne({ state });
      console.log('Any state document (including used/expired):', anyStateDoc ? 'YES' : 'NO');
      
      return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 });
    }

    // Mark state as used
    await db.collection('oauth_states').updateOne(
      { _id: stateDoc._id },
      { $set: { used: true } }
    );

    // Exchange code for token (standard OAuth flow)
    const tokenBody = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
    });

    console.log('Token exchange request body:', tokenBody.toString());

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody,
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Discord token error:', tokenData);
      return NextResponse.json({ error: 'Failed to exchange code for token' }, { status: 400 });
    }

    // Get user info from Discord
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    if (!userResponse.ok) {
      console.error('Discord user error:', userData);
      return NextResponse.json({ error: 'Failed to get user info' }, { status: 400 });
    }

    console.log('Discord user authenticated:', userData.username);

    // Store user data and link to wallet
    await db.collection('users').updateOne(
      { walletAddress: stateDoc.walletAddress },
      {
        $set: {
          discordId: userData.id,
          discordUsername: userData.username,
          discordDiscriminator: userData.discriminator,
          discordAvatar: userData.avatar,
          lastLogin: new Date(),
          verified: true
        }
      },
      { upsert: true }
    );

    // Create user session after successful Discord authentication
    const { response } = await createUserSession(stateDoc.walletAddress, userData.id);
    
    // Redirect to success page with session cookie
    const redirectResponse = NextResponse.redirect(`${process.env.NEXTAUTH_URL}/auth/success`);
    
    // Copy the session cookie from the createUserSession response
    const sessionCookie = response.cookies.get('session-token');
    if (sessionCookie) {
      redirectResponse.cookies.set(sessionCookie);
    }
    
    return redirectResponse;
  } catch (error) {
    console.error('Discord callback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}