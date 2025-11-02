'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChainInfo } from '@keplr-wallet/types';

// Extend Window interface to include Keplr
declare global {
  interface Window {
    keplr?: KeplrWallet;
  }
}

interface KeplrWallet {
  enable: (chainId: string) => Promise<void>;
  getOfflineSigner: (chainId: string) => OfflineSigner;
  getKey: (chainId: string) => Promise<{ bech32Address: string; name: string }>;
  experimentalSuggestChain: (chainInfo: ChainInfo) => Promise<void>;
  signArbitrary: (chainId: string, signer: string, data: string | Uint8Array) => Promise<StdSignature>;
}

interface StdSignature {
  pub_key: {
    type: string;
    value: string;
  };
  signature: string;
}

interface OfflineSigner {
  getAccounts: () => Promise<{ address: string }[]>;
}

interface WalletConnectionProps {
  onWalletConnect: (address: string) => void;
}

// Osmosis testnet configuration
const osmosisChain: ChainInfo = {
  chainId: process.env.NEXT_PUBLIC_COSMOS_CHAIN_ID || 'osmo-test-5',
  chainName: 'Osmosis Testnet',
  rpc: process.env.NEXT_PUBLIC_COSMOS_RPC_URL || 'https://rpc.testnet.osmosis.zone',
  rest: process.env.NEXT_PUBLIC_COSMOS_REST_URL || 'https://lcd.testnet.osmosis.zone',
  bip44: {
    coinType: 118,
  },
  bech32Config: {
    bech32PrefixAccAddr: 'osmo',
    bech32PrefixAccPub: 'osmopub',
    bech32PrefixValAddr: 'osmovaloper',
    bech32PrefixValPub: 'osmovaloperpub',
    bech32PrefixConsAddr: 'osmovalcons',
    bech32PrefixConsPub: 'osmovalconspub',
  },
  currencies: [
    {
      coinDenom: 'OSMO',
      coinMinimalDenom: 'uosmo',
      coinDecimals: 6,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: 'OSMO',
      coinMinimalDenom: 'uosmo',
      coinDecimals: 6,
    },
  ],
  stakeCurrency: {
    coinDenom: 'OSMO',
    coinMinimalDenom: 'uosmo',
    coinDecimals: 6,
  },
};

export default function WalletConnection({ onWalletConnect }: WalletConnectionProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnectingDiscord, setIsConnectingDiscord] = useState(false);
  const [error, setError] = useState('');
  // Removed roles view - only profile view now

  const handleDiscordConnect = async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setIsConnectingDiscord(true);
    setError('');

    try {
      // Step 1: Create secure session with wallet address
      const sessionResponse = await fetch('/api/auth/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error('Failed to create secure session');
      }

      const sessionData = await sessionResponse.json();
      
      // Step 2: Get Discord OAuth URL using the secure session
      const discordResponse = await fetch('/api/auth/discord', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: sessionData.sessionId
        }),
      });

      if (!discordResponse.ok) {
        throw new Error('Failed to generate Discord OAuth URL');
      }

      const discordData = await discordResponse.json();
      
      // Step 3: Validate and redirect to Discord OAuth (NO wallet address in URL)
      // Comprehensive validation of the Discord OAuth URL to prevent open redirect attacks
      const discordAuthUrl = discordData.discordAuthUrl;
      
      // Ensure the URL is a valid Discord OAuth URL
      if (!discordAuthUrl || typeof discordAuthUrl !== 'string') {
        throw new Error('Invalid Discord OAuth URL received');
      }
      
      // Validate that the URL is from Discord's domain
      try {
        const url = new URL(discordAuthUrl);
        
        // Strict validation: Ensure it's a legitimate Discord OAuth URL
        if (url.hostname !== 'discord.com' && url.hostname !== 'discordapp.com') {
          throw new Error('Invalid Discord OAuth domain');
        }
        
        // Ensure HTTPS protocol for security
        if (url.protocol !== 'https:') {
          throw new Error('Discord OAuth URL must use HTTPS');
        }
        
        // Ensure it's the correct OAuth endpoint
        if (!url.pathname.startsWith('/api/oauth2/authorize') && !url.pathname.startsWith('/oauth2/authorize')) {
          throw new Error('Invalid Discord OAuth endpoint');
        }
        
        // Validate required OAuth parameters are present
        const requiredParams = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state'];
        for (const param of requiredParams) {
          if (!url.searchParams.has(param)) {
            throw new Error(`Missing required OAuth parameter: ${param}`);
          }
        }
        
        // Validate OAuth response type
        const responseType = url.searchParams.get('response_type');
        if (responseType !== 'code') {
          throw new Error('Invalid OAuth response type');
        }
        
        // Validate redirect_uri points to our application with strict whitelist
        const redirectUri = url.searchParams.get('redirect_uri');
        if (redirectUri) {
          const redirectUrl = new URL(redirectUri);
          const currentHost = window.location.hostname;
          
          // More flexible localhost validation - handle various localhost formats
          const isLocalhost = (hostname: string) => {
            return hostname === 'localhost' || 
                   hostname === '127.0.0.1' || 
                   hostname === '0.0.0.0' ||
                   hostname.startsWith('localhost:') ||
                   hostname.startsWith('127.0.0.1:') ||
                   hostname.startsWith('0.0.0.0:') ||
                   /^localhost$/i.test(hostname) ||
                   /^127\.0\.0\.1$/.test(hostname);
          };
          
          // Allow current host or localhost variations
          const isValidHost = redirectUrl.hostname === currentHost || 
                             isLocalhost(redirectUrl.hostname) || 
                             isLocalhost(currentHost);
          
          if (!isValidHost) {
            throw new Error('Invalid redirect URI hostname');
          }
          
          // Additional security: ensure protocol is HTTPS in production or HTTP for localhost
          if (redirectUrl.protocol !== 'https:' && 
              !(isLocalhost(redirectUrl.hostname) && redirectUrl.protocol === 'http:')) {
            throw new Error('Invalid redirect URI protocol');
          }
          
          // Prevent path traversal and ensure redirect stays within our application
          if (redirectUrl.pathname.includes('..') || redirectUrl.pathname.includes('//')) {
            throw new Error('Invalid redirect URI path');
          }
          
          // Ensure redirect URI points to our application's callback endpoint
          if (!redirectUrl.pathname.startsWith('/api/auth/discord/callback') && 
              !redirectUrl.pathname.startsWith('/auth/discord/callback')) {
            throw new Error('Invalid redirect URI endpoint');
          }
        } else {
          throw new Error('Missing redirect_uri in Discord OAuth URL');
        }
        
        // All validations passed, reconstruct URL from validated parameters for maximum security
        const validatedUrl = new URL(discordAuthUrl);
        
        // Extract and validate required OAuth parameters
        const validatedClientId = validatedUrl.searchParams.get('client_id');
        const validatedRedirectUri = validatedUrl.searchParams.get('redirect_uri');
        const validatedResponseType = validatedUrl.searchParams.get('response_type');
        const validatedScope = validatedUrl.searchParams.get('scope');
        const validatedState = validatedUrl.searchParams.get('state');
        
        // Validate required parameters exist
        if (!validatedClientId || !validatedRedirectUri || !validatedResponseType || !validatedScope) {
          throw new Error('Missing required OAuth parameters');
        }
        
        // Construct secure Discord OAuth URL using validated parameters
        const secureDiscordUrl = new URL('https://discord.com/api/oauth2/authorize');
        secureDiscordUrl.searchParams.set('client_id', validatedClientId);
        secureDiscordUrl.searchParams.set('redirect_uri', validatedRedirectUri);
        secureDiscordUrl.searchParams.set('response_type', validatedResponseType);
        secureDiscordUrl.searchParams.set('scope', validatedScope);
        if (validatedState) {
          secureDiscordUrl.searchParams.set('state', validatedState);
        }
        
        // Safe redirect using reconstructed URL
        window.location.href = secureDiscordUrl.toString();
      } catch (urlError) {
        console.error('URL validation failed:', urlError);
        throw new Error(`Invalid Discord OAuth URL: ${urlError instanceof Error ? urlError.message : 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Discord connection failed:', err);
      setError(`Failed to connect Discord: ${err instanceof Error ? err.message : 'Please try again.'}`);
    } finally {
      setIsConnectingDiscord(false);
    }
  };

  const connectWallet = async () => {
    if (!window.keplr) {
      setError('Please install Keplr extension');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await window.keplr.experimentalSuggestChain(osmosisChain);
      await window.keplr.enable('osmo-test-5');
      
      const offlineSigner = window.keplr.getOfflineSigner(osmosisChain.chainId);
      const accounts = await offlineSigner.getAccounts();
      
      if (accounts.length > 0) {
        const userAddress = accounts[0].address;
        setAddress(userAddress);
        setIsConnected(true);
        onWalletConnect(userAddress);
        
        // Fetch balance
        await fetchBalance(userAddress);
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError('Failed to connect wallet. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBalance = async (walletAddress: string) => {
    try {
      const cosmosRestUrl = process.env.NEXT_PUBLIC_COSMOS_REST_URL || 'https://lcd.testnet.osmosis.zone';
      const response = await fetch(`${cosmosRestUrl}/cosmos/bank/v1beta1/balances/${walletAddress}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch balance');
      }
      
      const data = await response.json();
      const osmoBalance = data.balances?.find((b: { denom: string; amount: string }) => b.denom === 'uosmo');
      
      if (osmoBalance) {
        const balanceInOsmo = parseInt(osmoBalance.amount) / 1000000;
        setBalance(balanceInOsmo);
      } else {
        setBalance(0);
      }
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      setBalance(0);
    }
  };

  const disconnectWallet = () => {
    setIsConnected(false);
    setAddress('');
    setBalance(null);
    setError('');
  };

  if (!isConnected) {
    return (
      <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 shadow-2xl border border-white/20 max-w-4xl mx-auto">
        {/* Centered Logo */}
        <div className="text-center mb-4 pt-4">
          <Image 
            src="/imgs/logo.png" 
            alt="Logo" 
            width={156}
            height={156}
            className="mx-auto object-contain"
            style={{ width: 'auto', height: 'auto' }}
          />
        </div>

        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-black mb-4 font-druk mt-2">
            $CROWDP Interchain Token Gate
          </h1>
          <p className="text-black text-lg leading-relaxed font-poppins">
            Connect your Keplr wallet and in the next step your Discord to get access to my exclusive token gated roles for apha and edge.
          </p>
          <p className="text-black text-sm leading-relaxed font-poppins mt-3">
            This connection is secure, and you are allowing Crowdpunk read-only access of your wallet address and your $CROWDP token balance. You will not be asked to sign any transactions.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <button
          onClick={connectWallet}
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-black font-bold py-4 px-8 rounded-xl transition-all duration-300 transform hover:scale-105 disabled:hover:scale-100 text-lg shadow-lg shadow-teal-500/25 disabled:shadow-none font-button"
        >
          {isLoading ? 'Connecting...' : 'Connect Keplr Wallet'}
        </button>

        <div className="mt-6 text-center">
          <p className="text-sm text-black/60 font-poppins">
            <a 
              href="https://x.com/crowd_punk/status/1860058310365606359" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 hover:text-teal-700 underline font-poppins"
            >
              Read my Interchain Impact Rating (IIR) about Keplr
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-gradient-to-br from-teal-500/20 to-cyan-500/20 backdrop-blur-sm rounded-2xl p-8 border border-white/20 shadow-2xl max-w-4xl mx-auto">
      {/* Navigation Buttons - Top Right */}
      <div className="absolute top-6 right-6 flex space-x-4">
          <button
            className="px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-teal-500 to-cyan-500 text-black shadow-lg shadow-teal-500/25 font-button"
          >
            Profile
          </button>
          <button
            onClick={disconnectWallet}
            className="px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg shadow-red-500/25 font-button transition-all duration-300"
          >
            Disconnect
          </button>
        </div>

      {/* Centered Logo */}
      <div className="text-center mb-4">
        <Image 
          src="/imgs/logo.png" 
          alt="Logo" 
          width={156}
          height={156}
          className="mx-auto object-contain"
        />
      </div>
      
    

        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-black mb-2 font-druk">
            Wallet Connected
          </h2>
          <p className="text-black/80 text-lg font-poppins">
            By linking your wallet address and discord account, you may obtain exclusive and rewarding roles based on your token holdings. You will also receive your $CROWDP, which you may earn by engaging with the crowd and foster our collective success.
            <br />
            <strong>I am here for, and because of you! I am nothing without you. I love you!</strong>
          </p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <h3 className="text-sm font-semibold text-black/70 mb-3 uppercase tracking-wide font-druk">Address</h3>
            <p className="text-black font-mono text-sm break-all bg-black/20 p-3 rounded-lg font-poppins">{address}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <h3 className="text-sm font-semibold text-black/70 mb-3 uppercase tracking-wide font-druk">OSMO Balance</h3>
            <p className="text-black text-2xl font-bold font-poppins">{balance !== null ? balance.toFixed(2) : 'Loading...'} <span className="text-lg text-black/70 font-poppins">OSMO</span></p>
          </div>
        </div>

        <div className="mt-8">
          <button
            onClick={handleDiscordConnect}
            disabled={isConnectingDiscord}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-black font-bold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-105 disabled:hover:scale-100 shadow-lg shadow-indigo-500/25 font-button"
          >
            {isConnectingDiscord ? 'Connecting...' : 'Connect Discord Account'}
          </button>
        </div>
    </div>
  );
}