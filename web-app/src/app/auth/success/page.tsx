'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '../../components/Navbar';

export default function AuthSuccess() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [userInfo, setUserInfo] = useState<{
    discordUsername?: string;
    walletAddress?: string;
    assignedRoles?: string[];
  }>({});
  const [message, setMessage] = useState('Processing your Discord connection...');

  useEffect(() => {
    const processAuth = async () => {
      try {
        // Get user info from session
        const response = await fetch('/api/user/info', {
          credentials: 'include' // Include cookies for session
        });
        
        if (response.ok) {
          const userData = await response.json();
          
          if (userData.discordId && userData.walletAddress) {
            // User is authenticated, now assign roles
            setMessage('Assigning Discord roles...');
            
            const roleResponse = await fetch('/api/user/assign-roles', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include', // Include cookies for session
              body: JSON.stringify({
                walletAddress: userData.walletAddress
              })
            });

            if (roleResponse.ok) {
              const roleData = await roleResponse.json();
              
              setUserInfo({
                discordUsername: userData.discordUsername,
                walletAddress: userData.walletAddress,
                assignedRoles: roleData.assignedRoles || []
              });
              
              setStatus('success');
              setMessage('Discord connection and role assignment completed successfully!');
              
              // Redirect to home with success parameters after 3 seconds
              setTimeout(() => {
                const params = new URLSearchParams({
                  alert: 'success',
                  username: userData.discordUsername || '',
                  wallet: userData.walletAddress || '',
                  roles: (roleData.assignedRoles || []).join(',')
                });
                
                router.push(`/?${params.toString()}`);
              }, 3000);
            } else {
              const errorData = await roleResponse.json();
              throw new Error(errorData.error || 'Failed to assign roles');
            }
          } else {
            throw new Error('Incomplete authentication data');
          }
        } else {
          throw new Error('Failed to get user information');
        }
      } catch (error) {
        console.error('Auth success error:', error);
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'An error occurred during authentication');
        
        // Redirect to home with error after 3 seconds
        setTimeout(() => {
          const params = new URLSearchParams({
            alert: 'failed',
            message: error instanceof Error ? error.message : 'Authentication failed'
          });
          
          router.push(`/?${params.toString()}`);
        }, 3000);
      }
    };

    processAuth();
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Background with overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/imgs/secondary-bg.png')"
        }}
      />
      <div className="absolute inset-0 bg-black/20" />
      
      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />
        
        {/* Main Content */}
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-2xl">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-2xl">
              <div className="text-center">
                {/* Loading State */}
                {status === 'loading' && (
                  <>
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-6"></div>
                    <h1 className="text-3xl font-bold text-white mb-4">Processing...</h1>
                    <p className="text-white/80 text-lg">{message}</p>
                  </>
                )}

                {/* Success State */}
                {status === 'success' && (
                  <>
                    <div className="text-green-500 text-6xl mb-6">✅</div>
                    <h1 className="text-3xl font-bold text-white mb-4">Success!</h1>
                    <p className="text-white/80 text-lg mb-6">{message}</p>
                    
                    {userInfo.discordUsername && (
                      <div className="bg-white/5 rounded-lg p-4 mb-4">
                        <p className="text-white/90">
                          <span className="font-semibold">Discord:</span> {userInfo.discordUsername}
                        </p>
                        {userInfo.walletAddress && (
                          <p className="text-white/90 mt-2">
                            <span className="font-semibold">Wallet:</span> {userInfo.walletAddress.slice(0, 8)}...{userInfo.walletAddress.slice(-6)}
                          </p>
                        )}
                        {userInfo.assignedRoles && userInfo.assignedRoles.length > 0 && (
                          <p className="text-white/90 mt-2">
                            <span className="font-semibold">Roles:</span> {userInfo.assignedRoles.join(', ')}
                          </p>
                        )}
                      </div>
                    )}
                    
                    <p className="text-white/60 text-sm">Redirecting to home page...</p>
                  </>
                )}

                {/* Error State */}
                {status === 'error' && (
                  <>
                    <div className="text-red-500 text-6xl mb-6">❌</div>
                    <h1 className="text-3xl font-bold text-white mb-4">Error</h1>
                    <p className="text-white/80 text-lg mb-6">{message}</p>
                    <p className="text-white/60 text-sm">Redirecting to home page...</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}