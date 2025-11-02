import asyncio
import logging
import aiohttp
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
import threading
import time
import json
from anti_gaming_heuristics import AntiGamingHeuristics

logger = logging.getLogger(__name__)

class BalanceMonitor:
    def __init__(self):
        # Remove bot dependency - make it completely independent
        self.client: Optional[MongoClient] = None
        self.db: Optional[Database] = None
        self.users_collection: Optional[Collection] = None
        self.balance_history_collection: Optional[Collection] = None
        self.roles_collection: Optional[Collection] = None
        self.running = False
        self.monitor_thread = None
        
        # Anti-gaming heuristics
        self.anti_gaming: Optional[AntiGamingHeuristics] = None
        
        # Discord API configuration
        self.discord_token = os.getenv('DISCORD_BOT_TOKEN')  # Changed from DISCORD_TOKEN
        self.guild_id = os.getenv('DISCORD_GUILD_ID')
        self.discord_api_base = 'https://discord.com/api/v10'
        
        # Osmosis API configuration
        self.osmosis_api_url = os.getenv('OSMOSIS_API_URL', 'https://lcd.testnet.osmosis.zone')
        self.batch_size = 10  # Process wallets in batches of 10
        
    async def connect_db(self):
        """Connect to MongoDB database"""
        try:
            mongodb_uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/verifier-db')
            db_name = os.getenv('MONGODB_DB_NAME', 'verifier-db')
            
            self.client = MongoClient(mongodb_uri)
            self.db = self.client[db_name]
            self.users_collection = self.db['users']
            self.balance_history_collection = self.db['balance_history']
            self.roles_collection = self.db['roles']
            
            # Initialize anti-gaming heuristics
            self.anti_gaming = AntiGamingHeuristics(self.balance_history_collection)
            
            # Test the connection
            self.client.admin.command('ping')
            logger.info("Balance monitor connected to MongoDB")
            logger.info(f"Anti-gaming heuristics initialized with config: {self.anti_gaming.get_configuration()}")
            
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB in balance monitor: {e}")
            raise
    
    async def get_linked_wallets(self) -> List[Dict[str, Any]]:
        """Retrieve all wallet addresses linked to Discord IDs"""
        try:
            # Find all users with both walletAddress and discordId
            users = list(self.users_collection.find({
                'walletAddress': {'$exists': True, '$ne': None},
                'discordId': {'$exists': True, '$ne': None}
            }))
            
            logger.info(f"Found {len(users)} linked wallet addresses")
            return users
            
        except Exception as e:
            logger.error(f"Failed to get linked wallets: {e}")
            return []
    
    async def get_wallet_balance(self, session: aiohttp.ClientSession, wallet_address: str) -> float:
        """Get wallet balance from Osmosis API"""
        try:
            # Get all balances for the wallet
            url = f"{self.osmosis_api_url}/cosmos/bank/v1beta1/balances/{wallet_address}"
            
            async with session.get(url, timeout=10) as response:
                if response.status == 200:
                    data = await response.json()
                    balances = data.get('balances', [])
                    
                    # Calculate total balance (sum all denominations)
                    total_balance = 0.0
                    for balance in balances:
                        amount = float(balance.get('amount', 0))
                        # Convert from micro units to standard units (divide by 1,000,000)
                        total_balance += amount / 1_000_000
                    
                    return total_balance
                else:
                    logger.warning(f"Failed to get balance for {wallet_address}: HTTP {response.status}")
                    return 0.0
                    
        except asyncio.TimeoutError:
            logger.warning(f"Timeout getting balance for {wallet_address}")
            return 0.0
        except Exception as e:
            logger.error(f"Error getting balance for {wallet_address}: {e}")
            return 0.0
    
    async def batch_check_balances(self, wallets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Check balances for all wallets in batches"""
        balance_updates = []
        
        async with aiohttp.ClientSession() as session:
            # Process wallets in batches
            for i in range(0, len(wallets), self.batch_size):
                batch = wallets[i:i + self.batch_size]
                batch_tasks = []
                
                for wallet in batch:
                    wallet_address = wallet['walletAddress']
                    task = self.get_wallet_balance(session, wallet_address)
                    batch_tasks.append((wallet, task))
                
                # Execute batch concurrently
                for wallet, task in batch_tasks:
                    try:
                        current_balance = await task
                        previous_balance = wallet.get('lastKnownBalance', 0.0)
                        
                        # Check if balance changed
                        if abs(current_balance - previous_balance) > 0.000001:  # Account for floating point precision
                            balance_updates.append({
                                'userId': wallet['_id'],
                                'discordId': wallet['discordId'],
                                'walletAddress': wallet['walletAddress'],
                                'previousBalance': previous_balance,
                                'currentBalance': current_balance,
                                'balanceChange': current_balance - previous_balance,
                                'timestamp': datetime.utcnow()
                            })
                            
                            logger.info(f"Balance change detected for {wallet['walletAddress']}: {previous_balance} -> {current_balance}")
                    
                    except Exception as e:
                        logger.error(f"Error processing wallet {wallet.get('walletAddress', 'unknown')}: {e}")
                
                # Small delay between batches to avoid overwhelming the API
                await asyncio.sleep(0.5)
        
        return balance_updates
    
    async def save_balance_history(self, balance_updates: List[Dict[str, Any]]):
        """Save balance changes to history collection"""
        if not balance_updates:
            return
        
        try:
            # Insert balance history records
            self.balance_history_collection.insert_many(balance_updates)
            
            # Update user records with new balances
            for update in balance_updates:
                self.users_collection.update_one(
                    {'_id': update['userId']},
                    {
                        '$set': {
                            'lastKnownBalance': update['currentBalance'],
                            'lastBalanceCheck': update['timestamp']
                        }
                    }
                )
            
            logger.info(f"Saved {len(balance_updates)} balance updates to database")
            
        except Exception as e:
            logger.error(f"Failed to save balance history: {e}")
    
    async def get_roles_for_balance(self, balance: float) -> List[Dict[str, Any]]:
        """Get roles that a user qualifies for based on their balance"""
        try:
            if balance <= 0:
                return []
            
            # Get all roles from database
            all_roles = list(self.roles_collection.find({}))
            
            # Separate holder roles and amount roles
            holder_roles = [role for role in all_roles if role['type'] == 'holder']
            amount_roles = [role for role in all_roles if role['type'] == 'amount']
            
            # Filter amount roles that user qualifies for and sort by threshold descending
            qualified_amount_roles = [
                role for role in amount_roles 
                if role.get('amountThreshold', 0) <= balance
            ]
            qualified_amount_roles.sort(key=lambda x: x.get('amountThreshold', 0), reverse=True)
            
            # User gets holder roles (if balance > 0) + highest qualifying amount role only
            result_roles = []
            
            # Add holder roles if user has any balance
            if balance > 0:
                result_roles.extend(holder_roles)
            
            # Add only the highest qualifying amount role
            if qualified_amount_roles:
                result_roles.append(qualified_amount_roles[0])
            
            return result_roles
            
        except Exception as e:
            logger.error(f"Failed to get roles for balance: {e}")
            return []
    
    async def update_user_roles_direct(self, balance_updates: List[Dict[str, Any]]):
        """Update Discord roles using direct API calls (independent of bot instance)"""
        if not self.discord_token or not self.guild_id:
            logger.error("Discord token or guild ID not configured")
            return
        
        if not self.anti_gaming:
            logger.error("Anti-gaming heuristics not initialized")
            return

        headers = {
            'Authorization': f'Bot {self.discord_token}',
            'Content-Type': 'application/json'
        }
        
        async with aiohttp.ClientSession() as session:
            for update in balance_updates:
                try:
                    discord_id = str(update['discordId'])
                    wallet_address = update.get('walletAddress')
                    current_balance = update['currentBalance']
                    
                    # Run anti-gaming heuristics before role assignment
                    if wallet_address and current_balance > 0:
                        validation_result = await self.anti_gaming.validate_wallet_for_role_assignment(
                            wallet_address, current_balance
                        )
                        
                        if not validation_result['is_valid']:
                            logger.warning(f"Role assignment blocked for user {discord_id} (wallet: {wallet_address})")
                            logger.warning(f"Blocked reasons: {', '.join(validation_result['blocked_reasons'])}")
                            
                            # Log the blocked assignment for audit purposes
                            blocked_assignment = {
                                'timestamp': datetime.utcnow(),
                                'discordId': discord_id,
                                'walletAddress': wallet_address,
                                'currentBalance': current_balance,
                                'blocked_reasons': validation_result['blocked_reasons'],
                                'checks_performed': validation_result['checks_performed']
                            }
                            
                            # Store blocked assignment in database for audit
                            try:
                                blocked_collection = self.db['blocked_role_assignments']
                                blocked_collection.insert_one(blocked_assignment)
                                logger.info(f"Logged blocked role assignment for audit: {discord_id}")
                            except Exception as audit_error:
                                logger.error(f"Failed to log blocked assignment: {audit_error}")
                            
                            # Skip role assignment for this user
                            continue
                        else:
                            logger.info(f"Anti-gaming checks passed for user {discord_id}: {validation_result['checks_performed']}")
                    
                    # Get member info
                    member_url = f"{self.discord_api_base}/guilds/{self.guild_id}/members/{discord_id}"
                    async with session.get(member_url, headers=headers) as response:
                        if response.status != 200:
                            logger.warning(f"Member not found or inaccessible: {discord_id}")
                            continue
                        
                        member_data = await response.json()
                        current_roles = set(member_data.get('roles', []))
                    
                    # Get roles user should have based on new balance
                    qualified_roles = await self.get_roles_for_balance(update['currentBalance'])
                    qualified_role_ids = {role['discordRoleId'] for role in qualified_roles}
                    
                    # Get all managed roles from database
                    all_managed_roles = list(self.roles_collection.find({}))
                    all_managed_role_ids = {role['discordRoleId'] for role in all_managed_roles}
                    
                    # Current roles the member has that are managed by the bot
                    current_managed_roles = current_roles & all_managed_role_ids
                    
                    # Calculate roles to add and remove
                    roles_to_add = qualified_role_ids - current_managed_roles
                    roles_to_remove = current_managed_roles - qualified_role_ids
                    
                    # Update roles if there are changes
                    if roles_to_add or roles_to_remove:
                        new_roles = (current_roles - roles_to_remove) | roles_to_add
                        
                        # Update member roles via API
                        update_url = f"{self.discord_api_base}/guilds/{self.guild_id}/members/{discord_id}"
                        payload = {'roles': list(new_roles)}
                        
                        async with session.patch(update_url, headers=headers, json=payload) as response:
                            if response.status == 200:
                                logger.info(f"Successfully updated roles for user {discord_id}")
                                if roles_to_add:
                                    logger.info(f"Added roles: {roles_to_add}")
                                if roles_to_remove:
                                    logger.info(f"Removed roles: {roles_to_remove}")
                            else:
                                error_text = await response.text()
                                logger.error(f"Failed to update roles for user {discord_id}: {response.status} - {error_text}")
                
                except Exception as e:
                    logger.error(f"Failed to update roles for user {update.get('discordId', 'unknown')}: {e}")
    
    def schedule_role_update(self, balance_updates: List[Dict[str, Any]]):
        """Schedule role updates for users with balance changes"""
        if not balance_updates:
            return
        
        try:
            # Create a new thread to handle the async role update
            import threading
            
            def run_role_update():
                # Create a new event loop for this thread
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(self.update_user_roles_direct(balance_updates))
                    logger.info("Role update completed successfully")
                finally:
                    loop.close()
            
            # Run the role update in a separate thread
            thread = threading.Thread(target=run_role_update)
            thread.daemon = True
            thread.start()
            
        except Exception as e:
            logger.error(f"Failed to schedule role update: {e}")
    
    async def _update_user_roles_async(self, balance_updates: List[Dict[str, Any]]):
        """Legacy method - replaced by update_user_roles_direct"""
        # This method is now deprecated and replaced by update_user_roles_direct
        await self.update_user_roles_direct(balance_updates)
    
    async def monitor_cycle(self):
        """Single monitoring cycle"""
        try:
            logger.info("Starting balance monitoring cycle")
            
            # Get all linked wallets
            wallets = await self.get_linked_wallets()
            if not wallets:
                logger.info("No linked wallets found")
                return
            
            # Check balances in batches
            balance_updates = await self.batch_check_balances(wallets)
            
            if balance_updates:
                # Save balance history
                await self.save_balance_history(balance_updates)
                
                # Schedule Discord role updates
                self.schedule_role_update(balance_updates)
                
                logger.info(f"Completed balance monitoring cycle: {len(balance_updates)} updates processed")
            else:
                logger.info("No balance changes detected")
        
        except Exception as e:
            logger.error(f"Error in monitoring cycle: {e}")
    
    def start_monitoring(self):
        """Start the balance monitoring thread"""
        if self.running:
            logger.warning("Balance monitoring is already running")
            return
        
        self.running = True
        self.monitor_thread = threading.Thread(target=self._run_monitor_loop, daemon=True)
        self.monitor_thread.start()
        logger.info("Balance monitoring thread started")
    
    def stop_monitoring(self):
        """Stop the balance monitoring thread"""
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)
        logger.info("Balance monitoring thread stopped")
    
    def _run_monitor_loop(self):
        """Run the monitoring loop in a separate thread"""
        # Create a new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Connect to database
            loop.run_until_complete(self.connect_db())
            
            while self.running:
                try:
                    # Run monitoring cycle
                    loop.run_until_complete(self.monitor_cycle())
                    
                    # Wait 30 seconds before next cycle
                    for _ in range(30):
                        if not self.running:
                            break
                        time.sleep(1)
                
                except Exception as e:
                    logger.error(f"Error in monitor loop: {e}")
                    time.sleep(5)  # Wait 5 seconds before retrying
        
        finally:
            loop.close()

def main():
    """Main function to run the balance monitor as a standalone script"""
    # Load environment variables
    from dotenv import load_dotenv
    load_dotenv()
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    logger.info("Starting standalone balance monitor...")
    
    # Create and start balance monitor
    monitor = BalanceMonitor()
    
    try:
        monitor.start_monitoring()
        logger.info("Balance monitor started successfully. Press Ctrl+C to stop.")
        
        # Keep the main thread alive
        while monitor.running:
            time.sleep(1)
            
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, stopping balance monitor...")
        monitor.stop_monitoring()
        logger.info("Balance monitor stopped.")
    except Exception as e:
        logger.error(f"Error in main: {e}")
        monitor.stop_monitoring()

if __name__ == "__main__":
    main()