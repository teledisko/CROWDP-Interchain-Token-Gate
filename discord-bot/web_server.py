from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
import discord
from discord.ext import commands
import asyncio
import os
from dotenv import load_dotenv
import logging
import uvicorn
from typing import Optional, Annotated
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Discord bot instance for role management
bot_instance = None
# MongoDB client
mongo_client = None

class RoleAssignmentRequest(BaseModel):
    wallet_address: str
    role_id: str

class DiscordBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True  # Required for role management
        
        super().__init__(
            command_prefix='!',
            intents=intents,
            help_command=None
        )
        
    async def setup_hook(self):
        """Called when the bot is starting up"""
        logger.info(f"Web server bot logged in as {self.user} (ID: {self.user.id})")

# Initialize bot
discord_bot = DiscordBot()

# API Key authentication
async def verify_api_key(x_api_key: Annotated[str, Header()] = None):
    """Verify API key for protected endpoints"""
    expected_api_key = os.getenv('DISCORD_BOT_API_KEY')
    
    if not expected_api_key:
        raise HTTPException(status_code=500, detail="API key not configured on server")
    
    if not x_api_key:
        raise HTTPException(status_code=401, detail="API key required")
    
    if x_api_key != expected_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return True

@app.on_event("startup")
async def startup_event():
    """Start the Discord bot and MongoDB connection when FastAPI starts"""
    global bot_instance, mongo_client
    bot_instance = discord_bot
    
    # Initialize MongoDB connection
    mongodb_uri = os.getenv('MONGODB_URI')
    if mongodb_uri:
        mongo_client = AsyncIOMotorClient(mongodb_uri)
        logger.info("Connected to MongoDB")
    else:
        logger.warning("MONGODB_URI not found, user mapping will not work")
    
    token = os.getenv('DISCORD_BOT_TOKEN')
    if not token:
        logger.error("DISCORD_BOT_TOKEN not found in environment variables")
        raise HTTPException(status_code=500, detail="Discord bot token not configured")
    
    # Start bot in background
    asyncio.create_task(discord_bot.start(token))
    
    # Wait for bot to be ready
    await asyncio.sleep(3)

@app.post("/assign-test-role")
async def assign_test_role(request: RoleAssignmentRequest, _: bool = Depends(verify_api_key)):
    """Assign a test role to a user and remove it after 30 seconds"""
    try:
        if not bot_instance or not bot_instance.is_ready():
            raise HTTPException(status_code=503, detail="Discord bot is not ready")
        
        guild_id = int(os.getenv('DISCORD_GUILD_ID'))
        guild = bot_instance.get_guild(guild_id)
        
        if not guild:
            raise HTTPException(status_code=404, detail="Guild not found")
        
        # Find user by wallet address
        user_id = await get_discord_user_by_wallet(request.wallet_address)
        if not user_id:
            raise HTTPException(status_code=404, detail="User not found for this wallet address. Please connect your wallet to Discord first.")
        
        # Get the role
        role = guild.get_role(int(request.role_id))
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        
        member = guild.get_member(user_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found in guild")
        
        # Assign the role
        await member.add_roles(role, reason="Test role assignment from web interface")
        logger.info(f"Assigned test role {role.name} to {member.display_name}")
        
        # Schedule role removal after 30 seconds
        asyncio.create_task(remove_role_after_delay(member, role, 30))
        
        return {
            "success": True,
            "message": f"Test role '{role.name}' assigned to {member.display_name}. Will be removed after 30 seconds."
        }
        
    except Exception as e:
        logger.error(f"Error assigning test role: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def remove_role_after_delay(member: discord.Member, role: discord.Role, delay_seconds: int):
    """Remove a role from a member after a specified delay"""
    try:
        await asyncio.sleep(delay_seconds)
        await member.remove_roles(role, reason="Automatic removal after test period")
        logger.info(f"Removed test role {role.name} from {member.display_name} after {delay_seconds} seconds")
    except Exception as e:
        logger.error(f"Error removing test role: {e}")

async def get_discord_user_by_wallet(wallet_address: str) -> Optional[int]:
    """
    Get Discord user ID by wallet address from MongoDB
    """
    if not mongo_client:
        logger.error("MongoDB client not initialized")
        return None
    
    try:
        db = mongo_client[os.getenv('MONGODB_DB_NAME', 'cosmos-verifier')]
        users_collection = db['users']
        
        user = await users_collection.find_one({"walletAddress": wallet_address})
        
        if user and 'discordId' in user:
            return int(user['discordId'])
        
        return None
        
    except Exception as e:
        logger.error(f"Error querying database for wallet {wallet_address}: {e}")
        return None

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "bot_ready": bot_instance.is_ready() if bot_instance else False,
        "mongodb_connected": mongo_client is not None
    }

if __name__ == "__main__":
    # Bind to localhost only for security
    uvicorn.run(app, host="127.0.0.1", port=8000)