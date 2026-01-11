import { type User, type UpsertUser, type CustomEmail, type InsertCustomEmail } from "@shared/schema";
import { connectToMongoDB } from "./mongodb";
import crypto from "crypto";

export interface MobileAuthCode {
  code: string;
  userId: string;
  expiresAt: Date;
  used: boolean;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getCustomEmails(userId: string): Promise<CustomEmail[]>;
  addCustomEmail(email: InsertCustomEmail): Promise<CustomEmail>;
  deleteCustomEmail(userId: string, address: string): Promise<boolean>;
  saveMobileAuthCode(userId: string): Promise<string>;
  validateMobileAuthCode(code: string): Promise<string | null>;
}

export class MongoStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const db = await connectToMongoDB();
    const usersCollection = db.collection<User>("users");
    const user = await usersCollection.findOne({ id });
    return user || undefined;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const db = await connectToMongoDB();
    const usersCollection = db.collection<User>("users");
    
    const now = new Date();

    await usersCollection.updateOne(
      { id: userData.id },
      { 
        $set: { ...userData, updatedAt: now },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    const result = await usersCollection.findOne({ id: userData.id });
    if (!result) {
      throw new Error("Failed to upsert user");
    }
    return result;
  }

  async getCustomEmails(userId: string): Promise<CustomEmail[]> {
    const db = await connectToMongoDB();
    const customEmailsCollection = db.collection<CustomEmail>("customEmails");
    const emails = await customEmailsCollection.find({ userId }).toArray();
    return emails;
  }

  async addCustomEmail(emailData: InsertCustomEmail): Promise<CustomEmail> {
    const db = await connectToMongoDB();
    const customEmailsCollection = db.collection<CustomEmail>("customEmails");
    
    const existing = await customEmailsCollection.findOne({ 
      userId: emailData.userId, 
      address: emailData.address 
    });
    
    if (existing) {
      return existing;
    }

    await customEmailsCollection.insertOne(emailData);
    return emailData;
  }

  async deleteCustomEmail(userId: string, address: string): Promise<boolean> {
    const db = await connectToMongoDB();
    const customEmailsCollection = db.collection<CustomEmail>("customEmails");
    const result = await customEmailsCollection.deleteOne({ userId, address });
    return result.deletedCount > 0;
  }

  // NEW: Save mobile auth code
  async saveMobileAuthCode(userId: string): Promise<string> {
    const db = await connectToMongoDB();
    const mobileCodesCollection = db.collection<MobileAuthCode>("mobileAuthCodes");
    
    const code = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    
    // Delete any existing codes for this user
    await mobileCodesCollection.deleteMany({ userId });
    
    await mobileCodesCollection.insertOne({
      code,
      userId,
      expiresAt,
      used: false,
    });
    
    return code;
  }

  // NEW: Validate and consume mobile auth code
  async validateMobileAuthCode(code: string): Promise<string | null> {
    const db = await connectToMongoDB();
    const mobileCodesCollection = db.collection<MobileAuthCode>("mobileAuthCodes");
    
    const authCode = await mobileCodesCollection.findOne({
      code,
      used: false,
      expiresAt: { $gt: new Date() },
    });
    
    if (!authCode) {
      return null;
    }
    
    // Mark as used (single-use)
    await mobileCodesCollection.updateOne(
      { code },
      { $set: { used: true } }
    );
    
    return authCode.userId;
  }
}

export const storage = new MongoStorage();
