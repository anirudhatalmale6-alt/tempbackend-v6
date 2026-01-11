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
  authTimeout: 10000,
  connTimeout: 15000,
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

// LRU Cache implementation with bounded size and TTL
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

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  size(): number {
    return this.cache.size;
  }
}

// Bounded caches optimized for high traffic (memory-safe limits)
const emailCache = new LRUCache<string, FetchedEmail[]>(200, 30000); // 200 address caches, 30s TTL for high traffic
const emailDataCache = new LRUCache<string, CachedEmailData>(200, 180000); // 200 emails, 3min TTL (memory-safe for attachments)

// Enhanced Request Queue with exponential back-off and rate limit awareness
interface QueuedRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  execute: () => Promise<T>;
  retryCount: number;
  addedAt: number;
}

class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private activeConnections = 0;
  private maxConnections: number;
  private requestsPerSecond: number;
  private requestTimestamps: number[] = [];
  private rateLimitedUntil: number = 0;
  private consecutiveFailures: number = 0;
  private maxRetries: number = 3;
  private baseBackoffMs: number = 1000;
  private maxBackoffMs: number = 30000;

  constructor(maxConnections: number = 3, requestsPerSecond: number = 5) {
    this.maxConnections = maxConnections;
    this.requestsPerSecond = requestsPerSecond;
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, execute, retryCount: 0, addedAt: Date.now() });
      this.processQueue();
    });
  }

  // Called when API returns 429 with retryAfter
  setRateLimited(retryAfterSeconds: number): void {
    this.rateLimitedUntil = Date.now() + (retryAfterSeconds * 1000);
    console.log(`Rate limited for ${retryAfterSeconds}s, will resume at ${new Date(this.rateLimitedUntil).toISOString()}`);
  }

  private isRateLimited(): boolean {
    const now = Date.now();

    // Check if we're in a rate-limit cooldown period
    if (now < this.rateLimitedUntil) {
      return true;
    }

    // Check requests per second limit
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 1000);
    return this.requestTimestamps.length >= this.requestsPerSecond;
  }

  private getBackoffDelay(): number {
    if (this.consecutiveFailures === 0) return 0;
    const delay = Math.min(
      this.baseBackoffMs * Math.pow(2, this.consecutiveFailures - 1),
      this.maxBackoffMs
    );
    // Add jitter (±25%)
    return delay * (0.75 + Math.random() * 0.5);
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.activeConnections >= this.maxConnections) return;

    const now = Date.now();

    // Check rate limit cooldown
    if (now < this.rateLimitedUntil) {
      const waitTime = this.rateLimitedUntil - now;
      setTimeout(() => this.processQueue(), Math.min(waitTime + 100, 5000));
      return;
    }

    if (this.isRateLimited()) {
      setTimeout(() => this.processQueue(), 200);
      return;
    }

    // Apply exponential back-off if we've had failures
    const backoffDelay = this.getBackoffDelay();
    if (backoffDelay > 0) {
      setTimeout(() => {
        this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
        this.processQueue();
      }, backoffDelay);
      return;
    }

    const request = this.queue.shift();
    if (!request) return;

    this.activeConnections++;
    this.requestTimestamps.push(Date.now());

    try {
      const result = await request.execute();
      this.consecutiveFailures = 0; // Reset on success
      request.resolve(result);
    } catch (error) {
      this.consecutiveFailures++;

      // Retry with exponential back-off
      if (request.retryCount < this.maxRetries) {
        request.retryCount++;
        console.log(`Request failed, retry ${request.retryCount}/${this.maxRetries} after backoff`);
        this.queue.unshift(request); // Re-add to front of queue
      } else {
        console.error(`Request failed after ${this.maxRetries} retries`);
        request.reject(error as Error);
      }
    } finally {
      this.activeConnections--;
      // Small delay before processing next to prevent burst
      setTimeout(() => this.processQueue(), 100);
    }
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      activeConnections: this.activeConnections,
      maxConnections: this.maxConnections,
      consecutiveFailures: this.consecutiveFailures,
      rateLimitedUntil: this.rateLimitedUntil > Date.now() ? this.rateLimitedUntil : null,
    };
  }

  // Graceful shutdown - reject all pending requests
  shutdown(): void {
    const pendingRequests = this.queue.splice(0);
    pendingRequests.forEach(req => {
      req.reject(new Error("Queue shutdown"));
    });
  }
}

const requestQueue = new RequestQueue(3, 5); // Max 3 concurrent connections, 5 req/sec

// Export for rate limiter to call when 429 is returned
export function setRateLimited(retryAfterSeconds: number): void {
  requestQueue.setRateLimited(retryAfterSeconds);
}

// Persistent IMAP connection for IDLE mode with enhanced reconnection
let persistentImap: Imap | null = null;
let idleTimeout: NodeJS.Timeout | null = null;
let isIdleActive = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000;
const maxReconnectDelay = 60000;
const emailUpdateCallbacks: Set<() => void> = new Set();

// Debounce for IDLE notifications to prevent burst
let idleNotificationTimeout: NodeJS.Timeout | null = null;
const IDLE_DEBOUNCE_MS = 2000;

function createImapConnection(): Imap {
  return new Imap(imapConfig);
}

function getReconnectDelay(): number {
  const delay = Math.min(
    baseReconnectDelay * Math.pow(2, reconnectAttempts),
    maxReconnectDelay
  );
  // Add jitter (±25%)
  return delay * (0.75 + Math.random() * 0.5);
}

// Initialize persistent connection with IDLE support and exponential back-off
export function initPersistentConnection(): void {
  if (!imapConfig.user || !imapConfig.password) {
    console.log("Email credentials not configured, skipping persistent connection");
    return;
  }

  if (persistentImap) {
    try {
      persistentImap.end();
    } catch (e) {}
  }

  persistentImap = createImapConnection();

  persistentImap.once("ready", () => {
    console.log("Persistent IMAP connection established");
    reconnectAttempts = 0; // Reset on successful connection
    persistentImap!.openBox("INBOX", false, (err) => {
      if (err) {
        console.error("Error opening INBOX for IDLE:", err);
        scheduleReconnect();
        return;
      }
      startIdle();
    });
  });

  persistentImap.on("mail", () => {
    console.log("New email notification via IDLE");
    // Debounce to prevent burst of notifications
    if (idleNotificationTimeout) {
      clearTimeout(idleNotificationTimeout);
    }
    idleNotificationTimeout = setTimeout(() => {
      clearCache();
      notifyEmailUpdate();
    }, IDLE_DEBOUNCE_MS);
  });

  persistentImap.on("expunge", () => {
    console.log("Email deleted notification via IDLE");
    // Debounce to prevent burst
    if (idleNotificationTimeout) {
      clearTimeout(idleNotificationTimeout);
    }
    idleNotificationTimeout = setTimeout(() => {
      clearCache();
      notifyEmailUpdate();
    }, IDLE_DEBOUNCE_MS);
  });

  persistentImap.once("error", (err: Error) => {
    console.error("Persistent IMAP error:", err.message);
    isIdleActive = false;
    scheduleReconnect();
  });

  persistentImap.once("end", () => {
    console.log("Persistent IMAP connection ended");
    isIdleActive = false;
    scheduleReconnect();
  });

  persistentImap.connect();
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.error(`Max reconnect attempts (${maxReconnectAttempts}) reached. Giving up.`);
    // Reset after a longer delay to try again later
    setTimeout(() => {
      reconnectAttempts = 0;
      initPersistentConnection();
    }, 5 * 60 * 1000); // 5 minutes
    return;
  }

  reconnectAttempts++;
  const delay = getReconnectDelay();
  console.log(`Scheduling IMAP reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${Math.round(delay)}ms`);
  setTimeout(initPersistentConnection, delay);
}

function startIdle(): void {
  if (!persistentImap || isIdleActive) return;

  try {
    isIdleActive = true;

    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      if (persistentImap && isIdleActive) {
        isIdleActive = false;
        persistentImap.openBox("INBOX", false, () => {
          startIdle();
        });
      }
    }, 25 * 60 * 1000);

    console.log("IDLE mode started - listening for new emails");
  } catch (err) {
    console.error("Error starting IDLE:", err);
    isIdleActive = false;
  }
}

function notifyEmailUpdate(): void {
  emailUpdateCallbacks.forEach(callback => {
    try {
      callback();
    } catch (e) {}
  });
}

export function onEmailUpdate(callback: () => void): () => void {
  emailUpdateCallbacks.add(callback);
  return () => emailUpdateCallbacks.delete(callback);
}

// Fetch emails with request queue, caching, and retry logic
export async function fetchEmails(targetAddress?: string): Promise<FetchedEmail[]> {
  const cacheKey = targetAddress || "all";

  // Check cache first
  const cached = emailCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Use request queue to limit concurrent connections
  return requestQueue.enqueue(async () => {
    // Double-check cache after getting queue slot
    const cachedAgain = emailCache.get(cacheKey);
    if (cachedAgain) return cachedAgain;

    return new Promise<FetchedEmail[]>((resolve, reject) => {
      if (!imapConfig.user || !imapConfig.password) {
        console.log("Email credentials not configured, returning empty inbox");
        resolve([]);
        return;
      }

      const imap = createImapConnection();
      const emails: FetchedEmail[] = [];
      let connectionTimeout: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
        try { imap.end(); } catch (e) {}
      };

      const safeResolve = (result: FetchedEmail[]) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      const safeReject = (error: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(error);
      };

      // Increased timeout with proper cleanup
      connectionTimeout = setTimeout(() => {
        console.log("IMAP connection timeout, using cache");
        safeResolve([]);
      }, 15000);

      imap.once("ready", () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);

        imap.openBox("INBOX", false, (err, box) => {
          if (err) {
            safeReject(err);
            return;
          }

          if (!box.messages.total) {
            emailCache.set(cacheKey, []);
            safeResolve([]);
            return;
          }

          const searchCriteria = targetAddress
            ? [["TO", targetAddress]]
            : ["ALL"];

          imap.search(searchCriteria as any, (searchErr, results) => {
            if (searchErr) {
              safeReject(searchErr);
              return;
            }

            if (!results.length) {
              emailCache.set(cacheKey, []);
              safeResolve([]);
              return;
            }

            // Fetch last 50 emails (most recent)
            const recentResults = results.slice(-50);
            const fetch = imap.fetch(recentResults, {
              bodies: "",
              struct: true,
            });
            let pending = recentResults.length;

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

                  if (targetAddress && toAddress.toLowerCase() !== targetAddress.toLowerCase()) {
                    pending--;
                    if (pending === 0) {
                      emailCache.set(cacheKey, emails);
                      safeResolve(emails);
                    }
                    return;
                  }

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
                if (pending === 0) {
                  emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                  emailCache.set(cacheKey, emails);
                  safeResolve(emails);
                }
              });
            });

            fetch.once("error", (fetchErr) => {
              safeReject(fetchErr);
            });

            fetch.once("end", () => {
              if (pending === 0) {
                emailCache.set(cacheKey, emails);
                safeResolve(emails);
              }
            });
          });
        });
      });

      imap.once("error", (imapErr: Error) => {
        console.error("IMAP connection error:", imapErr.message);
        safeResolve([]); // Return empty rather than rejecting for graceful degradation
      });

      imap.once("end", () => {});

      imap.connect();
    });
  });
}

export async function deleteEmail(emailId: string): Promise<boolean> {
  const cachedData = emailDataCache.get(emailId);

  return requestQueue.enqueue(async () => {
    return new Promise<boolean>((resolve, reject) => {
      if (!imapConfig.user || !imapConfig.password) {
        resolve(false);
        return;
      }

      const imap = createImapConnection();
      let resolved = false;

      const safeResolve = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        try { imap.end(); } catch (e) {}
        resolve(result);
      };

      imap.once("ready", () => {
        imap.openBox("INBOX", false, (err) => {
          if (err) {
            safeResolve(false);
            return;
          }

          const searchCriteria = cachedData?.email?.uid
            ? [[`UID`, cachedData.email.uid]]
            : [["HEADER", "MESSAGE-ID", emailId]];

          imap.search(searchCriteria as any, (searchErr, results) => {
            if (searchErr || !results.length) {
              safeResolve(false);
              return;
            }

            imap.addFlags(results, "\\Deleted", (flagErr) => {
              if (flagErr) {
                safeResolve(false);
                return;
              }

              imap.expunge((expErr) => {
                if (expErr) {
                  safeResolve(false);
                } else {
                  emailCache.clear();
                  emailDataCache.delete(emailId);
                  safeResolve(true);
                }
              });
            });
          });
        });
      });

      imap.once("error", (imapErr: Error) => {
        console.error("IMAP delete error:", imapErr.message);
        safeResolve(false);
      });

      imap.connect();
    });
  });
}

export function clearCache(): void {
  emailCache.clear();
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

  return requestQueue.enqueue(async () => {
    return new Promise<AttachmentData | null>((resolve) => {
      if (!imapConfig.user || !imapConfig.password) {
        resolve(null);
        return;
      }

      const imap = createImapConnection();
      let resolved = false;

      const safeResolve = (result: AttachmentData | null) => {
        if (resolved) return;
        resolved = true;
        try { imap.end(); } catch (e) {}
        resolve(result);
      };

      imap.once("ready", () => {
        imap.openBox("INBOX", false, (err) => {
          if (err) {
            safeResolve(null);
            return;
          }

          const searchCriteria = cachedData?.email?.uid
            ? [["UID", cachedData.email.uid]]
            : [["HEADER", "MESSAGE-ID", emailId]];

          imap.search(searchCriteria as any, (searchErr, results) => {
            if (searchErr || !results.length) {
              safeResolve(null);
              return;
            }

            const fetch = imap.fetch(results, { bodies: "" });

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
                    emailDataCache.set(emailId, {
                      email: cachedData?.email || {} as FetchedEmail,
                      rawAttachments: parsed.attachments,
                      cachedAt: Date.now(),
                    });

                    safeResolve({
                      content: attachment.content,
                      contentType: attachment.contentType,
                      filename: attachment.filename || filename,
                    });
                  } else {
                    safeResolve(null);
                  }
                } catch {
                  safeResolve(null);
                }
              });
            });

            fetch.once("error", () => {
              safeResolve(null);
            });
          });
        });
      });

      imap.once("error", () => {
        safeResolve(null);
      });

      imap.connect();
    });
  });
}

// Export queue stats for monitoring
export function getQueueStats() {
  return requestQueue.getStats();
}

// Graceful shutdown handler
export function shutdown(): void {
  console.log("Shutting down email service...");

  // Clear pending notifications
  if (idleNotificationTimeout) {
    clearTimeout(idleNotificationTimeout);
    idleNotificationTimeout = null;
  }

  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }

  // Close persistent IMAP connection
  if (persistentImap) {
    try {
      persistentImap.end();
    } catch (e) {}
    persistentImap = null;
  }

  // Shutdown request queue
  requestQueue.shutdown();

  // Clear callbacks
  emailUpdateCallbacks.clear();

  console.log("Email service shutdown complete");
}

// Initialize persistent connection on module load
initPersistentConnection();
