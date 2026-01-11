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

// Cache TTL - background fetch keeps data fresh
const emailCache = new LRUCache<string, FetchedEmail[]>(500, 15000); // 15 seconds TTL
const emailDataCache = new LRUCache<string, CachedEmailData>(500, 600000); // 10 minutes TTL

// ============================================
// SINGLE PERSISTENT CONNECTION FOR ALL OPERATIONS
// ============================================
let lastFetchTime = 0;
let allEmailsCache: FetchedEmail[] = [];
let allEmailsCacheTime = 0;
const ALL_EMAILS_CACHE_TTL = 15000; // 15 seconds cache - background fetch keeps it fresh
let isFetching = false;

// Request coalescing
const pendingRequests = new Map<string, Promise<FetchedEmail[]>>();

// Main IMAP connection - reused for all operations
let mainConnection: Imap | null = null;
let mainConnectionReady = false;
let mainConnectionPromise: Promise<Imap> | null = null;

function getMainConnection(): Promise<Imap> {
  // If already connected, return it
  if (mainConnection && mainConnectionReady) {
    return Promise.resolve(mainConnection);
  }

  // If connecting, wait for it
  if (mainConnectionPromise) {
    return mainConnectionPromise;
  }

  // Create new connection
  mainConnectionPromise = new Promise((resolve, reject) => {
    console.log("Creating main IMAP connection...");
    const conn = new Imap(imapConfig);

    const timeout = setTimeout(() => {
      mainConnectionPromise = null;
      try { conn.end(); } catch (e) {}
      reject(new Error("Connection timeout"));
    }, 30000);

    conn.once("ready", () => {
      clearTimeout(timeout);
      console.log("Main IMAP connection established");
      mainConnection = conn;
      mainConnectionReady = true;
      resolve(conn);
    });

    conn.once("error", (err: Error) => {
      clearTimeout(timeout);
      console.error("Main IMAP connection error:", err.message);
      mainConnectionReady = false;
      mainConnection = null;
      mainConnectionPromise = null;
      reject(err);
    });

    conn.once("end", () => {
      console.log("Main IMAP connection ended");
      mainConnectionReady = false;
      mainConnection = null;
      mainConnectionPromise = null;
      // Reconnect after delay
      setTimeout(() => {
        getMainConnection().catch(() => {});
      }, 5000);
    });

    conn.once("close", () => {
      console.log("Main IMAP connection closed");
      mainConnectionReady = false;
      mainConnection = null;
      mainConnectionPromise = null;
      // Reconnect after delay
      setTimeout(() => {
        getMainConnection().catch(() => {});
      }, 5000);
    });

    conn.connect();
  });

  return mainConnectionPromise;
}

// For delete/attachment operations that need write access
function createFreshConnection(): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const conn = new Imap(imapConfig);

    const timeout = setTimeout(() => {
      try { conn.end(); } catch (e) {}
      reject(new Error("Connection timeout"));
    }, 25000);

    conn.once("ready", () => {
      clearTimeout(timeout);
      resolve(conn);
    });

    conn.once("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    conn.connect();
  });
}

// ============================================
// FETCH ALL EMAILS ONCE, FILTER IN MEMORY
// ============================================
let fetchPromise: Promise<FetchedEmail[]> | null = null;

async function fetchAllEmailsOnce(): Promise<FetchedEmail[]> {
  const now = Date.now();

  // Return cached if fresh
  if (allEmailsCache.length > 0 && (now - allEmailsCacheTime) < ALL_EMAILS_CACHE_TTL) {
    console.log("Using all-emails cache");
    return allEmailsCache;
  }

  // If already fetching, wait for that fetch
  if (isFetching && fetchPromise) {
    console.log("Waiting for in-progress fetch");
    return fetchPromise;
  }

  // Rate limit: minimum 1 second between fetches
  if (now - lastFetchTime < 1000) {
    console.log("Rate limiting fetch, using cache");
    return allEmailsCache.length > 0 ? allEmailsCache : Array.from(globalEmailStore.values());
  }

  lastFetchTime = now;
  isFetching = true;

  fetchPromise = (async () => {
    let conn: Imap | null = null;
    try {
      console.log("Creating dedicated fetch connection...");
      conn = await createFreshConnection();
      const emails = await doFetchAllEmails(conn);
      allEmailsCache = emails;
      allEmailsCacheTime = Date.now();
      return emails;
    } catch (err) {
      console.error("Error fetching emails:", err);
      return allEmailsCache.length > 0 ? allEmailsCache : Array.from(globalEmailStore.values());
    } finally {
      isFetching = false;
      fetchPromise = null;
      // Close the dedicated fetch connection
      if (conn) {
        try { conn.end(); } catch (e) {}
      }
    }
  })();

  return fetchPromise;
}

// Global email store - accumulates emails over time
let globalEmailStore: Map<string, FetchedEmail> = new Map();

function doFetchAllEmails(conn: Imap): Promise<FetchedEmail[]> {
  return new Promise((resolve) => {
    const newEmails: FetchedEmail[] = [];

    conn.openBox("INBOX", false, (err, box) => {
      if (err) {
        console.error("Error opening INBOX:", err);
        resolve(Array.from(globalEmailStore.values()));
        return;
      }

      if (!box || !box.messages.total) {
        console.log("No messages in INBOX");
        resolve(Array.from(globalEmailStore.values()));
        return;
      }

      const total = box.messages.total;
      console.log(`INBOX has ${total} messages, fetching last 15...`);

      // Direct sequence fetch - fetch only last 15 for speed
      const startSeq = Math.max(1, total - 14);
      const range = `${startSeq}:${total}`;
      const expectedCount = Math.min(15, total);

      let resolved = false;
      let messageReceived = 0;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log(`Fetch timeout, got ${newEmails.length}/${expectedCount} messages`);
          finishFetch(newEmails, resolve);
        }
      }, 20000); // 20 second timeout - messages arrive slowly

      console.log(`Fetching sequence ${range}`);

      const fetch = conn.seq.fetch(range, {
        bodies: ["HEADER", "TEXT"],
        struct: true,
      });

      fetch.on("message", (msg, seqno) => {
        messageReceived++;
        console.log(`Message ${messageReceived} received (seq ${seqno})`);

        let headerBuffer = "";
        let textBuffer = "";
        let uid = seqno;
        let flags: string[] = [];

        msg.on("attributes", (attrs) => {
          uid = attrs.uid || seqno;
          flags = attrs.flags || [];
        });

        msg.on("body", (stream, info) => {
          let buffer = "";
          stream.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
          });

          stream.once("end", () => {
            if (info.which === "HEADER") {
              headerBuffer = buffer;
            } else {
              textBuffer = buffer;
            }
          });
        });

        msg.once("end", () => {
          // Combine header and text for parsing
          const fullEmail = headerBuffer + "\r\n" + textBuffer;

          simpleParser(fullEmail).then((parsed) => {
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
              isRead: flags.includes("\\Seen"),
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

            newEmails.push(email);
            console.log(`Parsed email ${newEmails.length}: ${email.subject?.substring(0, 30)}...`);

            if (newEmails.length >= expectedCount && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              finishFetch(newEmails, resolve);
            }
          }).catch((parseErr) => {
            console.error("Parse error:", parseErr);
          });
        });
      });

      fetch.once("error", (fetchErr) => {
        console.error("Fetch error:", fetchErr);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          finishFetch(newEmails, resolve);
        }
      });

      fetch.once("end", () => {
        console.log(`Fetch end event, received ${messageReceived} messages`);
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            finishFetch(newEmails, resolve);
          }
        }, 500); // Wait 0.5s for parsing to complete
      });
    });
  });
}

function finishFetch(newEmails: FetchedEmail[], resolve: (emails: FetchedEmail[]) => void): void {
  // Immediate finish - no delay
  newEmails.forEach(e => globalEmailStore.set(e.id, e));
  const allEmails = Array.from(globalEmailStore.values());
  allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  console.log(`Finished: ${newEmails.length} new, ${allEmails.length} total`);
  resolve(allEmails);
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

  const requestPromise = (async () => {
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

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function deleteEmail(emailId: string): Promise<boolean> {
  const cachedData = emailDataCache.get(emailId);
  let conn: Imap | null = null;

  try {
    conn = await createFreshConnection();

    return new Promise<boolean>((resolve) => {
      conn!.openBox("INBOX", false, (err) => {
        if (err) {
          if (conn) try { conn.end(); } catch (e) {}
          resolve(false);
          return;
        }

        const searchCriteria = cachedData?.email?.uid
          ? [["UID", cachedData.email.uid]]
          : [["HEADER", "MESSAGE-ID", emailId]];

        conn!.search(searchCriteria as any, (searchErr, results) => {
          if (searchErr || !results.length) {
            if (conn) try { conn.end(); } catch (e) {}
            resolve(false);
            return;
          }

          conn!.addFlags(results, "\\Deleted", (flagErr) => {
            if (flagErr) {
              if (conn) try { conn.end(); } catch (e) {}
              resolve(false);
              return;
            }

            conn!.expunge((expErr) => {
              if (conn) try { conn.end(); } catch (e) {}
              if (expErr) {
                resolve(false);
              } else {
                // Clear caches
                emailCache.clear();
                emailDataCache.delete(emailId);
                globalEmailStore.delete(emailId);
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
    if (conn) try { conn.end(); } catch (e) {}
    return false;
  }
}

export function clearCache(): void {
  emailCache.clear();
  allEmailsCache = [];
  allEmailsCacheTime = 0;
  // Don't clear globalEmailStore - it accumulates emails
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
  let conn: Imap | null = null;
  try {
    conn = await createFreshConnection();

    return new Promise<AttachmentData | null>((resolve) => {
      conn!.openBox("INBOX", true, (err) => {
        if (err) {
          if (conn) try { conn.end(); } catch (e) {}
          resolve(null);
          return;
        }

        const searchCriteria = cachedData?.email?.uid
          ? [["UID", cachedData.email.uid]]
          : [["HEADER", "MESSAGE-ID", emailId]];

        conn!.search(searchCriteria as any, (searchErr, results) => {
          if (searchErr || !results.length) {
            if (conn) try { conn.end(); } catch (e) {}
            resolve(null);
            return;
          }

          const fetch = conn!.fetch(results, { bodies: "" });

          fetch.on("message", (msg) => {
            let buffer = "";

            msg.on("body", (stream) => {
              stream.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
              });
            });

            msg.once("end", async () => {
              if (conn) try { conn.end(); } catch (e) {}
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
            if (conn) try { conn.end(); } catch (e) {}
            resolve(null);
          });
        });
      });
    });
  } catch (err) {
    console.error("Attachment fetch error:", err);
    if (conn) try { conn.end(); } catch (e) {}
    return null;
  }
}

// IDLE support
let persistentImap: Imap | null = null;
let idleTimeout: NodeJS.Timeout | null = null;
let isIdleActive = false;
let idleNotificationTimeout: NodeJS.Timeout | null = null;
const IDLE_DEBOUNCE_MS = 500; // 0.5 second debounce (instant response)
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
    console.log("New email notification via IDLE - fetching immediately");
    // Immediately invalidate cache AND trigger fetch
    allEmailsCacheTime = 0;
    emailCache.clear();
    // Proactively fetch new emails right away
    fetchAllEmailsOnce().catch(err => console.error("Proactive fetch failed:", err));
    // Debounce the notification callbacks
    if (idleNotificationTimeout) clearTimeout(idleNotificationTimeout);
    idleNotificationTimeout = setTimeout(() => {
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
    isFetching,
    allEmailsCacheSize: allEmailsCache.length,
    globalStoreSize: globalEmailStore.size,
    allEmailsCacheAge: Date.now() - allEmailsCacheTime,
    pendingRequests: pendingRequests.size,
  };
}

export function setRateLimited(seconds: number): void {
  // No-op now, handled internally
}

export function shutdown(): void {
  console.log("Shutting down email service...");

  if (backgroundFetchInterval) clearInterval(backgroundFetchInterval);
  if (idleNotificationTimeout) clearTimeout(idleNotificationTimeout);
  if (idleTimeout) clearTimeout(idleTimeout);

  if (persistentImap) {
    try { persistentImap.end(); } catch (e) {}
    persistentImap = null;
  }

  if (mainConnection) {
    try { mainConnection.end(); } catch (e) {}
    mainConnection = null;
    mainConnectionReady = false;
  }

  emailUpdateCallbacks.clear();
  pendingRequests.clear();

  console.log("Email service shutdown complete");
}

// Background fetch loop - keeps emails fresh
let backgroundFetchInterval: NodeJS.Timeout | null = null;

function startBackgroundFetch(): void {
  // Fetch immediately on startup
  fetchAllEmailsOnce().catch(err => console.error("Initial fetch failed:", err));

  // Then fetch every 10 seconds in background
  backgroundFetchInterval = setInterval(() => {
    if (!isFetching) {
      console.log("Background fetch triggered");
      allEmailsCacheTime = 0; // Force refresh
      fetchAllEmailsOnce().catch(err => console.error("Background fetch failed:", err));
    }
  }, 10000);
}

// Initialize connections on startup (with delay)
setTimeout(() => {
  // Start main connection first
  getMainConnection().then(() => {
    console.log("Main connection ready, starting IDLE and background fetch...");
    initPersistentConnection();
    startBackgroundFetch();
  }).catch(err => {
    console.error("Initial main connection failed:", err);
    // Still try IDLE connection and background fetch
    initPersistentConnection();
    startBackgroundFetch();
  });
}, 2000);
