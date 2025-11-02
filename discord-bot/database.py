import os
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

logger = logging.getLogger(__name__)

class RoleDatabase:
    def __init__(self):
        self.client: Optional[MongoClient] = None
        self.db: Optional[Database] = None
        self.roles_collection: Optional[Collection] = None
        self.balance_history: Optional[Collection] = None
        
    async def connect(self):
        """Connect to MongoDB database"""
        try:
            mongodb_uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/verifier-db')
            db_name = os.getenv('MONGODB_DB_NAME', 'verifier-db')
            
            self.client = MongoClient(mongodb_uri)
            self.db = self.client[db_name]
            self.roles_collection = self.db['roles']
            self.balance_history = self.db['balance_history']
            
            # Test the connection
            self.client.admin.command('ping')
            logger.info(f"Successfully connected to MongoDB: {db_name}")
            
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise
    
    async def disconnect(self):
        """Disconnect from MongoDB"""
        if self.client:
            self.client.close()
            logger.info("Disconnected from MongoDB")
    
    async def add_role(self, name: str, discord_role_id: str, amount_threshold: Optional[float] = None, 
                      role_type: str = 'holder', created_by: str = None) -> Dict[str, Any]:
        """Add a new role to the database"""
        try:
            role_data = {
                'name': name,
                'discordRoleId': discord_role_id,
                'type': role_type,
                'createdAt': datetime.utcnow(),
                'updatedAt': datetime.utcnow()
            }
            
            if amount_threshold is not None:
                role_data['amountThreshold'] = amount_threshold
                
            if created_by:
                role_data['createdBy'] = created_by
            
            result = self.roles_collection.insert_one(role_data)
            role_data['_id'] = str(result.inserted_id)
            
            logger.info(f"Added role: {name} (ID: {discord_role_id})")
            return role_data
            
        except Exception as e:
            logger.error(f"Failed to add role: {e}")
            raise
    
    async def get_all_roles(self) -> List[Dict[str, Any]]:
        """Get all roles from the database"""
        try:
            roles = list(self.roles_collection.find({}))
            # Convert ObjectId to string
            for role in roles:
                role['_id'] = str(role['_id'])
            
            logger.info(f"Retrieved {len(roles)} roles from database")
            return roles
            
        except Exception as e:
            logger.error(f"Failed to get roles: {e}")
            raise
    
    async def get_roles_by_type(self, role_type: str) -> List[Dict[str, Any]]:
        """Get roles by type (holder or amount)"""
        try:
            roles = list(self.roles_collection.find({'type': role_type}))
            # Convert ObjectId to string
            for role in roles:
                role['_id'] = str(role['_id'])
            
            logger.info(f"Retrieved {len(roles)} roles of type '{role_type}'")
            return roles
            
        except Exception as e:
            logger.error(f"Failed to get roles by type: {e}")
            raise
    
    async def get_roles_for_balance(self, balance: float) -> List[Dict[str, Any]]:
        """Get roles that a user qualifies for based on their balance"""
        try:
            # Only return roles if balance > 0
            if balance <= 0:
                logger.info(f"Balance {balance} is 0 or negative, returning no roles")
                return []
            
            # Get all holder roles (no amount threshold) and amount roles where balance meets threshold
            query = {
                '$or': [
                    {'type': 'holder'},
                    {'type': 'amount', 'amountThreshold': {'$lte': balance}}
                ]
            }
            
            roles = list(self.roles_collection.find(query))
            # Convert ObjectId to string
            for role in roles:
                role['_id'] = str(role['_id'])
            
            logger.info(f"Retrieved {len(roles)} roles for balance {balance}")
            return roles
            
        except Exception as e:
            logger.error(f"Failed to get roles for balance: {e}")
            raise
    
    async def role_exists(self, discord_role_id: str) -> bool:
        """Check if a role with the given Discord role ID already exists"""
        try:
            count = self.roles_collection.count_documents({'discordRoleId': discord_role_id})
            return count > 0
            
        except Exception as e:
            logger.error(f"Failed to check if role exists: {e}")
            raise
    
    async def delete_role(self, discord_role_id: str) -> bool:
        """Delete a role by Discord role ID"""
        try:
            result = self.roles_collection.delete_one({'discordRoleId': discord_role_id})
            success = result.deleted_count > 0
            
            if success:
                logger.info(f"Deleted role with Discord ID: {discord_role_id}")
            else:
                logger.warning(f"No role found with Discord ID: {discord_role_id}")
                
            return success
            
        except Exception as e:
            logger.error(f"Failed to delete role: {e}")
            raise
    
    async def update_role(self, discord_role_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a role by Discord role ID"""
        try:
            updates['updatedAt'] = datetime.utcnow()
            
            result = self.roles_collection.find_one_and_update(
                {'discordRoleId': discord_role_id},
                {'$set': updates},
                return_document=True
            )
            
            if result:
                result['_id'] = str(result['_id'])
                logger.info(f"Updated role with Discord ID: {discord_role_id}")
            else:
                logger.warning(f"No role found with Discord ID: {discord_role_id}")
                
            return result
            
        except Exception as e:
            logger.error(f"Failed to update role: {e}")
            raise

# Global database instance
db = RoleDatabase()