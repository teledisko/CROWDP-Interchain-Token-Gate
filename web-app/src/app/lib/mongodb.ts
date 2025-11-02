import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your Mongo URI to .env.local');
}

const uri: string = process.env.MONGODB_URI;

// Validate MongoDB URI contains authentication credentials
function validateMongoUri(uri: string): void {
  try {
    const url = new URL(uri);
    
    // Check if URI contains authentication credentials
    if (!url.username || !url.password) {
      console.warn('⚠️  MongoDB URI does not contain authentication credentials. This is insecure for production.');
      
      // In production, require authentication only for remote connections (not localhost)
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1' && !process.env.NEXT_PHASE && !isLocalhost) {
        throw new Error('MongoDB authentication is required in production environment for remote connections');
      }
    }
    
    // Validate protocol
    if (!['mongodb:', 'mongodb+srv:'].includes(url.protocol)) {
      throw new Error('Invalid MongoDB URI protocol. Must be mongodb:// or mongodb+srv://');
    }
    
    // Validate hostname
    if (!url.hostname) {
      throw new Error('MongoDB URI must contain a valid hostname');
    }
    
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Invalid MongoDB URI format');
    }
    throw error;
  }
}

// Validate the URI before proceeding
validateMongoUri(uri);

const options = {
  // Security options
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4, // Use IPv4, skip trying IPv6
  // Enable SSL/TLS for production only for remote connections
  ...(process.env.NODE_ENV === 'production' && {
    tls: !uri.includes('localhost') && !uri.includes('127.0.0.1'),
    tlsAllowInvalidCertificates: false,
  }),
};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB_NAME || 'cosmos-verifier');
  return { client, db };
}

export default clientPromise;