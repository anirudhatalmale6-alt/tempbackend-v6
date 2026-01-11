import Imap from "imap";
import { simpleParser, ParsedMail, Attachment } from "mailparser";
import type { Email } from "@shared/schema";

const imapConfig = {
  user: process.env.EMAIL_USER || "",
  password: process.env.EMAIL_PASSWORD || "",
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
  keepalive: true,
  authTimeout: 30000,
  connTimeout: 30000,
};

interface FetchedEmail {
  id: string;
  uid: number;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  date: string;
  textContent?: string;
  htmlContent?: string;
  isRead: boolean;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

interface CachedEmailData {
  email: FetchedEmail;
  rawAttachments?: Attachment[];
  cachedAt: number;
}

// LRU Cache
class LRUCache<K, V> {
  private cache: Map<K, { value: V; timestamp: number }>;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttlMs: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Short cache TTL for fast email updates
const emailCache = new LRUCache<string, FetchedEmail[]>(500, 10000); // 10 seconds TTL
const emailDataCache = new LRUCache<string, CachedEmailData>(500, 600000); // 10 minutes TTL

// ============================================
// SINGLE SHARED IMAP CONNECTION
// ============================================
let sharedConnection: Imap | null = null;
let connectionState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
let connectionPromise: Promise<Imap> | null = null;
let lastFetchTime = 0;
let allEmailsCache: FetchedEmail[] = [];
let allEmailsCacheTime = 0;
const ALL_EMAILS_CACHE_TTL = 10000; // 10 seconds for all emails cache (fast updates)

// Request coalescing
const pendingRequests = new Map<string, Promise<FetchedEmail[]>>();

async function getSharedConnection(): Promise<Imap> {
  // If already connected, return
  if (sharedConnection && connectionState === 'connected') {
    return sharedConnection;
  }

  // If connecting, wait for it
  if (connectionState === 'connecting' && connectionPromise) {
    return connectionPromise;
  }

  // Create new connection
  connectionState = 'connecting';
  connectionPromise = new Promise((resolve, reject) => {
    console.log("Creating shared IMAP connection...");
    const conn = new Imap(imapConfig);

    const timeout = setTimeout(() => {
      connectionState = 'error';
      try { conn.end(); } catch (e) {}
      reject(new Error("Connection timeout"));
    }, 30000);

    conn.once("ready", () => {
      clearTimeout(timeout);
      console.log("Shared IMAP connection established");
      sharedConnection = conn;
      connectionState = 'connected';

      // Open inbox and keep it open
      conn.openBox("INBOX", false, (err) => {
        if (err) {
          console.error("Error opening INBOX:", err);
          connectionState = 'error';
          reject(err);
          return;
        }
        resolve(conn);
      });
    });

    conn.once("error", (err: Error) => {
      clearTimeout(timeout);
      console.error("Shared IMAP connection error:", err.message);
      connectionState = 'error';
      sharedConnection = null;
      reject(err);
    });

    conn.once("end", () => {
      console.log("Shared IMAP connection ended");
      connectionState = 'disconnected';
      sharedConnection = null;
      connectionPromise = null;
    });

    conn.once("close", () => {
      console.log("Shared IMAP connection closed");
      connectionState = 'disconnected';
      sharedConnection = null;
      connectionPromise = null;
      // Reconnect after delay
      setTimeout(() => {
        if (connectionState === 'disconnected') {
          getSharedConnection().catch(() => {});
        }
      }, 5000);
    });

    conn.connect();
  });

  return connectionPromise;
}

// ============================================
// FETCH ALL EMAILS ONCE, FILTER IN MEMORY
// ============================================
async function fetchAllEmailsOnce(): Promise<FetchedEmail[]> {
  const now = Date.now();

  // Return cached if fresh
  if (allEmailsCache.length > 0 && (now - allEmailsCacheTime) < ALL_EMAILS_CACHE_TTL) {
    console.log("Using all-emails cache");
    return allEmailsCache;
  }

  // Rate limit: minimum 2 seconds between fetches (allows fast updates)
  if (now - lastFetchTime < 2000) {
    console.log("Rate limiting fetch, using cache");
    return allEmailsCache;
  }

  lastFetchTime = now;

  try {
    const conn = await getSharedConnection();
    const emails = await doFetchAllEmails(conn);
    allEmailsCache = emails;
    allEmailsCacheTime = Date.now();
    return emails;
  } catch (err) {
    console.error("Error fetching emails:", err);
    // Return stale cache on error
    return allEmailsCache;
  }
}

function doFetchAllEmails(conn: Imap): Promise<FetchedEmail[]> {
  return new Promise((resolve) => {
    const emails: FetchedEmail[] = [];

    // Re-open box to refresh
    conn.openBox("INBOX", false, (err, box) => {
      if (err) {
        console.error("Error opening INBOX for fetch:", err);
        resolve([]);
        return;
      }

      if (!box || !box.messages.total) {
        resolve([]);
        return;
      }

      // Fetch ALL emails (last 100 for performance)
      conn.search(["ALL"], (searchErr, results) => {
        if (searchErr || !results.length) {
          resolve([]);
          return;
        }

        const recentResults = results.slice(-100);
        const fetch = conn.fetch(recentResults, {
          bodies: "",
          struct: true,
        });

        let pending = recentResults.length;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log("Fetch timeout, returning partial results");
            resolve(emails);
          }
        }, 60000); // 60 second timeout for fetch

        fetch.on("message", (msg, seqno) => {
          let buffer = "";
          let uid = seqno;

          msg.on("attributes", (attrs) => {
            uid = attrs.uid || seqno;
          });

          msg.on("body", (stream) => {
            stream.on("data", (chunk) => {
              buffer += chunk.toString("utf8");
            });
          });

          msg.once("end", async () => {
            try {
              const parsed: ParsedMail = await simpleParser(buffer);

              const fromAddress = parsed.from?.value?.[0]?.address || "unknown@unknown.com";
              const fromName = parsed.from?.value?.[0]?.name || "";
              const toAddress: string = (Array.isArray(parsed.to)
                ? parsed.to[0]?.value?.[0]?.address
                : parsed.to?.value?.[0]?.address) || "";

              const emailId = parsed.messageId || `uid-${uid}`;

              const email: FetchedEmail = {
                id: emailId,
                uid: uid,
                from: fromAddress,
                fromName: fromName,
                to: toAddress,
                subject: parsed.subject || "(No subject)",
                date: parsed.date?.toISOString() || new Date().toISOString(),
                textContent: parsed.text || "",
                htmlContent: parsed.html || undefined,
                isRead: false,
                attachments: parsed.attachments?.map((att: Attachment) => ({
                  filename: att.filename || "attachment",
                  contentType: att.contentType,
                  size: att.size,
                })),
              };

              emailDataCache.set(emailId, {
                email,
                rawAttachments: parsed.attachments,
                cachedAt: Date.now(),
              });

              emails.push(email);
            } catch (parseErr) {
              console.error("Error parsing email:", parseErr);
            }

            pending--;
            if (pending === 0 && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              console.log(`Fetched ${emails.length} emails`);
              resolve(emails);
            }
          });
        });

        fetch.once("error", (fetchErr) => {
          console.error("Fetch error:", fetchErr);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(emails);
          }
        });

        fetch.once("end", () => {
          if (pending === 0 && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(emails);
          }
        });
      });
    });
  });
}

// ============================================
// PUBLIC API
// ============================================
export async function fetchEmails(targetAddress?: string): Promise<FetchedEmail[]> {
  const cacheKey = targetAddress || "all";

  // Check specific address cache first
  const cached = emailCache.get(cacheKey);
  if (cached) {
    console.log(`Cache hit for ${cacheKey}`);
    return cached;
  }

  // Coalesce requests
  if (pendingRequests.has(cacheKey)) {
    console.log(`Coalescing request for ${cacheKey}`);
    return pendingRequests.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      // Fetch all emails once
      const allEmails = await fetchAllEmailsOnce();

      // Filter in memory
      let result: FetchedEmail[];
      if (targetAddress) {
        result = allEmails.filter(e =>
          e.to.toLowerCase() === targetAddress.toLowerCase()
        );
      } else {
        result = allEmails;
      }

      // Cache the filtered result
      emailCache.set(cacheKey, result);
      return result;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function deleteEmail(emailId: string): Promise<boolean> {
  const cachedData = emailDataCache.get(emailId);

  try {
    const conn = await getSharedConnection();

    return new Promise<boolean>((resolve) => {
      conn.openBox("INBOX", false, (err) => {
        if (err) {
          resolve(false);
          return;
        }

        const searchCriteria = cachedData?.email?.uid
          ? [["UID", cachedData.email.uid]]
          : [["HEADER", "MESSAGE-ID", emailId]];

        conn.search(searchCriteria as any, (searchErr, results) => {
          if (searchErr || !results.length) {
            resolve(false);
            return;
          }

          conn.addFlags(results, "\\Deleted", (flagErr) => {
            if (flagErr) {
              resolve(false);
              return;
            }

            conn.expunge((expErr) => {
              if (expErr) {
                resolve(false);
              } else {
                // Clear caches
                emailCache.clear();
                emailDataCache.delete(emailId);
                allEmailsCache = [];
                allEmailsCacheTime = 0;
                resolve(true);
              }
            });
          });
        });
      });
    });
  } catch (err) {
    console.error("Delete error:", err);
    return false;
  }
}

export function clearCache(): void {
  emailCache.clear();
  allEmailsCache = [];
  allEmailsCacheTime = 0;
}

interface AttachmentData {
  content: Buffer;
  contentType: string;
  filename: string;
}

export async function getAttachment(emailId: string, filename: string): Promise<AttachmentData | null> {
  const cachedData = emailDataCache.get(emailId);

  if (cachedData?.rawAttachments) {
    const attachment = cachedData.rawAttachments.find(
      (att) => att.filename === filename ||
               att.filename?.toLowerCase() === filename.toLowerCase()
    );

    if (attachment) {
      return {
        content: attachment.content,
        contentType: attachment.contentType,
        filename: attachment.filename || filename,
      };
    }
  }

  // Fetch from IMAP if not in cache
  try {
    const conn = await getSharedConnection();

    return new Promise<AttachmentData | null>((resolve) => {
      conn.openBox("INBOX", false, (err) => {
        if (err) {
          resolve(null);
          return;
        }

        const searchCriteria = cachedData?.email?.uid
          ? [["UID", cachedData.email.uid]]
          : [["HEADER", "MESSAGE-ID", emailId]];

        conn.search(searchCriteria as any, (searchErr, results) => {
          if (searchErr || !results.length) {
            resolve(null);
            return;
          }

          const fetch = conn.fetch(results, { bodies: "" });

          fetch.on("message", (msg) => {
            let buffer = "";

            msg.on("body", (stream) => {
              stream.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
              });
            });

            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(buffer);
                const attachment = parsed.attachments?.find(
                  (att: Attachment) => att.filename === filename ||
                           att.filename?.toLowerCase() === filename.toLowerCase()
                );

                if (attachment) {
                  resolve({
                    content: attachment.content,
                    contentType: attachment.contentType,
                    filename: attachment.filename || filename,
                  });
                } else {
                  resolve(null);
                }
              } catch {
                resolve(null);
              }
            });
          });

          fetch.once("error", () => {
            resolve(null);
          });
        });
      });
    });
  } catch (err) {
    console.error("Attachment fetch error:", err);
    return null;
  }
}

// IDLE support
let persistentImap: Imap | null = null;
let idleTimeout: NodeJS.Timeout | null = null;
let isIdleActive = false;
let idleNotificationTimeout: NodeJS.Timeout | null = null;
const IDLE_DEBOUNCE_MS = 3000; // 3 seconds debounce (fast response to new emails)
const emailUpdateCallbacks: Set<() => void> = new Set();

export function initPersistentConnection(): void {
  if (!imapConfig.user || !imapConfig.password) {
    console.log("Email credentials not configured");
    return;
  }

  if (persistentImap) {
    try { persistentImap.end(); } catch (e) {}
  }

  persistentImap = new Imap(imapConfig);

  persistentImap.once("ready", () => {
    console.log("Persistent IMAP connection established");
    persistentImap!.openBox("INBOX", false, (err) => {
      if (err) {
        console.error("Error opening INBOX for IDLE:", err);
        setTimeout(initPersistentConnection, 30000);
        return;
      }
      startIdle();
    });
  });

  persistentImap.on("mail", () => {
    console.log("New email notification via IDLE");
    // Immediately invalidate cache so next request fetches fresh
    allEmailsCacheTime = 0;
    // Debounce the notification callbacks
    if (idleNotificationTimeout) clearTimeout(idleNotificationTimeout);
    idleNotificationTimeout = setTimeout(() => {
      clearCache();
      notifyEmailUpdate();
    }, IDLE_DEBOUNCE_MS);
  });

  persistentImap.on("expunge", () => {
    console.log("Email deleted notification via IDLE");
    // Immediately invalidate cache so next request fetches fresh
    allEmailsCacheTime = 0;
    // Debounce the notification callbacks
    if (idleNotificationTimeout) clearTimeout(idleNotificationTimeout);
    idleNotificationTimeout = setTimeout(() => {
      clearCache();
      notifyEmailUpdate();
    }, IDLE_DEBOUNCE_MS);
  });

  persistentImap.once("error", (err: Error) => {
    console.error("Persistent IMAP error:", err.message);
    isIdleActive = false;
    setTimeout(initPersistentConnection, 30000);
  });

  persistentImap.once("end", () => {
    console.log("Persistent IMAP connection ended");
    isIdleActive = false;
    setTimeout(initPersistentConnection, 30000);
  });

  persistentImap.connect();
}

function startIdle(): void {
  if (!persistentImap || isIdleActive) return;
  isIdleActive = true;

  if (idleTimeout) clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => {
    if (persistentImap && isIdleActive) {
      isIdleActive = false;
      persistentImap.openBox("INBOX", false, () => startIdle());
    }
  }, 25 * 60 * 1000);

  console.log("IDLE mode started - listening for new emails");
}

function notifyEmailUpdate(): void {
  emailUpdateCallbacks.forEach(cb => { try { cb(); } catch (e) {} });
}

export function onEmailUpdate(callback: () => void): () => void {
  emailUpdateCallbacks.add(callback);
  return () => emailUpdateCallbacks.delete(callback);
}

export function getQueueStats() {
  return {
    connectionState,
    allEmailsCacheSize: allEmailsCache.length,
    allEmailsCacheAge: Date.now() - allEmailsCacheTime,
    pendingRequests: pendingRequests.size,
  };
}

export function setRateLimited(seconds: number): void {
  // No-op now, handled internally
}

export function shutdown(): void {
  console.log("Shutting down email service...");

  if (idleNotificationTimeout) clearTimeout(idleNotificationTimeout);
  if (idleTimeout) clearTimeout(idleTimeout);

  if (persistentImap) {
    try { persistentImap.end(); } catch (e) {}
    persistentImap = null;
  }

  if (sharedConnection) {
    try { sharedConnection.end(); } catch (e) {}
    sharedConnection = null;
  }

  connectionState = 'disconnected';
  emailUpdateCallbacks.clear();
  pendingRequests.clear();

  console.log("Email service shutdown complete");
}

// Initialize connections on startup (with delay)
setTimeout(() => {
  getSharedConnection().catch(err => {
    console.error("Initial connection failed:", err);
  });
  initPersistentConnection();
}, 3000);
