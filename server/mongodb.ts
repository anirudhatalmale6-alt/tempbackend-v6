import { MongoClient, Db, Collection } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export interface ContactSubmission {
  _id?: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: Date;
}

export async function connectToMongoDB(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db("tempmail");
    console.log("Connected to MongoDB successfully");
    
    // Create indexes for better performance under high load
    await createIndexes(db);
    
    return db;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    throw error;
  }
}

async function createIndexes(database: Db): Promise<void> {
  try {
    // Users collection indexes
    const usersCollection = database.collection("users");
    await usersCollection.createIndex({ id: 1 }, { unique: true, background: true });
    await usersCollection.createIndex({ email: 1 }, { background: true });
    
    // Custom emails collection indexes
    const customEmailsCollection = database.collection("customEmails");
    await customEmailsCollection.createIndex({ userId: 1 }, { background: true });
    await customEmailsCollection.createIndex({ address: 1 }, { background: true });
    await customEmailsCollection.createIndex(
      { userId: 1, address: 1 }, 
      { unique: true, background: true }
    );
    
    // Contacts collection indexes
    const contactsCollection = database.collection("contacts");
    await contactsCollection.createIndex({ email: 1 }, { background: true });
    await contactsCollection.createIndex({ createdAt: -1 }, { background: true });
    
    // Sessions collection indexes (for express-session)
    const sessionsCollection = database.collection("sessions");
    await sessionsCollection.createIndex({ expires: 1 }, { expireAfterSeconds: 0, background: true });
    
    console.log("MongoDB indexes created successfully");
  } catch (error) {
    console.error("Error creating MongoDB indexes:", error);
    // Don't throw - indexes are for optimization, not critical
  }
}

export async function getContactsCollection(): Promise<Collection<ContactSubmission>> {
  const database = await connectToMongoDB();
  return database.collection<ContactSubmission>("contacts");
}

export async function saveContactSubmission(submission: Omit<ContactSubmission, "_id" | "createdAt">): Promise<string> {
  const collection = await getContactsCollection();
  const result = await collection.insertOne({
    ...submission,
    createdAt: new Date()
  });
  return result.insertedId.toString();
}

export async function closeMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
