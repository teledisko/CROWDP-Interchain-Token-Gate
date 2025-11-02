import asyncio
import logging
import aiohttp
import os
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List, Tuple
from pymongo.collection import Collection
import statistics

logger = logging.getLogger(__name__)

class AntiGamingHeuristics:
    """
    Anti-gaming heuristics to prevent automated role farming and wallet manipulation.
    
    Implements basic but effective checks to block:
    - New wallets (< 7 days old)
    - Wallets with extreme balance volatility (> 50% change in 10 minutes)
    """
    
    def __init__(self, balance_history_collection: Collection):
        self.balance_history_collection = balance_history_collection
        
        # Configuration - can be moved to config file later
        self.min_wallet_age_days = int(os.getenv('MIN_WALLET_AGE_DAYS', '7'))
        self.max_volatility_threshold = float(os.getenv('MAX_VOLATILITY_THRESHOLD', '0.5'))  # 50%
        self.volatility_window_minutes = int(os.getenv('VOLATILITY_WINDOW_MINUTES', '10'))
        
        # Osmosis API configuration
        self.osmosis_api_url = os.getenv('OSMOSIS_API_URL', 'https://lcd.testnet.osmosis.zone')
        
    async def check_wallet_age(self, wallet_address: str) -> Tuple[bool, str]:
        """
        Check if wallet is older than minimum required age.
        
        Args:
            wallet_address: The wallet address to check
            
        Returns:
            Tuple of (is_valid, reason)
        """
        try:
            async with aiohttp.ClientSession() as session:
                # Get transaction history to find first transaction
                tx_url = f"{self.osmosis_api_url}/cosmos/tx/v1beta1/txs"
                params = {
                    'events': f'message.sender=\'{wallet_address}\'',
                    'order_by': 'ORDER_BY_ASC',  # Oldest first
                    'limit': 1
                }
                
                async with session.get(tx_url, params=params) as response:
                    if response.status != 200:
                        logger.warning(f"Failed to fetch transaction history for {wallet_address}: {response.status}")
                        # If we can't verify age, allow it (permissive approach)
                        return True, "Age verification unavailable - allowed"
                    
                    data = await response.json()
                    
                    if not data.get('txs') or len(data['txs']) == 0:
                        # No transactions found - very new wallet or inactive
                        return False, f"No transaction history found - wallet appears to be new or inactive"
                    
                    # Parse first transaction timestamp
                    first_tx = data['txs'][0]
                    timestamp_str = first_tx.get('timestamp')
                    
                    if not timestamp_str:
                        logger.warning(f"No timestamp found in first transaction for {wallet_address}")
                        return True, "Timestamp unavailable - allowed"
                    
                    # Parse timestamp (format: 2024-01-15T10:30:45Z)
                    first_tx_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    wallet_age = datetime.now(first_tx_time.tzinfo) - first_tx_time
                    
                    min_age = timedelta(days=self.min_wallet_age_days)
                    
                    if wallet_age < min_age:
                        return False, f"Wallet too new: {wallet_age.days} days old (minimum: {self.min_wallet_age_days} days)"
                    
                    return True, f"Wallet age verified: {wallet_age.days} days old"
                    
        except Exception as e:
            logger.error(f"Error checking wallet age for {wallet_address}: {e}")
            # On error, be permissive - don't block legitimate users due to API issues
            return True, f"Age check failed - allowed due to error: {str(e)}"
    
    async def check_balance_volatility(self, wallet_address: str, current_balance: float) -> Tuple[bool, str]:
        """
        Check if wallet has extreme balance volatility in recent time window.
        
        Args:
            wallet_address: The wallet address to check
            current_balance: Current balance of the wallet
            
        Returns:
            Tuple of (is_valid, reason)
        """
        try:
            # Get recent balance history from our database
            cutoff_time = datetime.utcnow() - timedelta(minutes=self.volatility_window_minutes)
            
            recent_balances = list(self.balance_history_collection.find({
                'walletAddress': wallet_address,
                'timestamp': {'$gte': cutoff_time}
            }).sort('timestamp', 1))
            
            if len(recent_balances) < 2:
                # Not enough data points - allow it
                return True, "Insufficient balance history for volatility check"
            
            # Extract balance values including current balance
            balance_values = [record['currentBalance'] for record in recent_balances]
            balance_values.append(current_balance)
            
            # Calculate moving average change
            if len(balance_values) < 3:
                return True, "Insufficient data points for volatility calculation"
            
            # Calculate percentage changes between consecutive balance checks
            percentage_changes = []
            for i in range(1, len(balance_values)):
                prev_balance = balance_values[i-1]
                curr_balance = balance_values[i]
                
                if prev_balance > 0:  # Avoid division by zero
                    change = abs(curr_balance - prev_balance) / prev_balance
                    percentage_changes.append(change)
            
            if not percentage_changes:
                return True, "No valid balance changes to analyze"
            
            # Check if any change exceeds threshold
            max_change = max(percentage_changes)
            
            if max_change > self.max_volatility_threshold:
                return False, f"Extreme balance volatility detected: {max_change:.1%} change in {self.volatility_window_minutes} minutes (max allowed: {self.max_volatility_threshold:.1%})"
            
            # Also check average volatility
            avg_change = statistics.mean(percentage_changes)
            if avg_change > (self.max_volatility_threshold * 0.7):  # 70% of max threshold
                return False, f"High average volatility: {avg_change:.1%} average change (threshold: {self.max_volatility_threshold * 0.7:.1%})"
            
            return True, f"Balance volatility acceptable: max {max_change:.1%}, avg {avg_change:.1%}"
            
        except Exception as e:
            logger.error(f"Error checking balance volatility for {wallet_address}: {e}")
            # On error, be permissive
            return True, f"Volatility check failed - allowed due to error: {str(e)}"
    
    async def validate_wallet_for_role_assignment(self, wallet_address: str, current_balance: float) -> Dict[str, Any]:
        """
        Run all anti-gaming heuristics on a wallet before role assignment.
        
        Args:
            wallet_address: The wallet address to validate
            current_balance: Current balance of the wallet
            
        Returns:
            Dict with validation results:
            {
                'is_valid': bool,
                'blocked_reasons': List[str],
                'warnings': List[str],
                'checks_performed': Dict[str, Any]
            }
        """
        result = {
            'is_valid': True,
            'blocked_reasons': [],
            'warnings': [],
            'checks_performed': {}
        }
        
        try:
            # Check wallet age
            age_valid, age_reason = await self.check_wallet_age(wallet_address)
            result['checks_performed']['wallet_age'] = {
                'valid': age_valid,
                'reason': age_reason
            }
            
            if not age_valid:
                result['is_valid'] = False
                result['blocked_reasons'].append(f"Wallet Age: {age_reason}")
            
            # Check balance volatility
            volatility_valid, volatility_reason = await self.check_balance_volatility(wallet_address, current_balance)
            result['checks_performed']['balance_volatility'] = {
                'valid': volatility_valid,
                'reason': volatility_reason
            }
            
            if not volatility_valid:
                result['is_valid'] = False
                result['blocked_reasons'].append(f"Balance Volatility: {volatility_reason}")
            
            # Log the validation result
            if result['is_valid']:
                logger.info(f"Wallet {wallet_address} passed all anti-gaming checks")
            else:
                logger.warning(f"Wallet {wallet_address} blocked by anti-gaming heuristics: {', '.join(result['blocked_reasons'])}")
            
        except Exception as e:
            logger.error(f"Error validating wallet {wallet_address}: {e}")
            # On critical error, be permissive but log warning
            result['warnings'].append(f"Validation error: {str(e)}")
            result['checks_performed']['error'] = str(e)
        
        return result
    
    def get_configuration(self) -> Dict[str, Any]:
        """Get current anti-gaming configuration"""
        return {
            'min_wallet_age_days': self.min_wallet_age_days,
            'max_volatility_threshold': self.max_volatility_threshold,
            'volatility_window_minutes': self.volatility_window_minutes,
            'osmosis_api_url': self.osmosis_api_url
        }
    
    def update_configuration(self, config: Dict[str, Any]) -> None:
        """Update anti-gaming configuration"""
        if 'min_wallet_age_days' in config:
            self.min_wallet_age_days = int(config['min_wallet_age_days'])
        if 'max_volatility_threshold' in config:
            self.max_volatility_threshold = float(config['max_volatility_threshold'])
        if 'volatility_window_minutes' in config:
            self.volatility_window_minutes = int(config['volatility_window_minutes'])
        
        logger.info(f"Updated anti-gaming configuration: {self.get_configuration()}")