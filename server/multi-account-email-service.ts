import Imap from "imap";
import { simpleParser, ParsedMail, Attachment } from "mailparser";
import type { ProviderEmail, EmailProvider as SchemaEmailProvider } from "@shared/schema";
import {
  AccountIdentifier,
  getAllAccountIdentifiers,
  createImapConfig,
  initializeAccounts,
  isAliasEmail,
  getBaseEmailFromAlias,
} from "./email-accounts";

interface FetchedProviderEmail extends ProviderEmail {
  uid: number;
  rawAttachments?: Attachment[];
}

interface CachedEmailData {
  email: FetchedProviderEmail;
  rawAttachments?: Attachment[];
  cachedAt: number;
}

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

// Bounded caches optimized for high traffic (memory-safe limits)
const providerEmailCache = new LRUCache<string, FetchedProviderEmail[]>(200, 30000); // 200 entries, 30s TTL
const providerEmailDataCache = new LRUCache<string, CachedEmailData>(200, 180000); // 200 emails, 3min TTL (memory-safe for attachments)

// Enhanced request queue with exponential back-off and rate limit awareness
class ProviderRequestQueue {
  private queue: Array<{
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    execute: () => Promise<any>;
    retryCount: number;
    addedAt: number;
  }> = [];
  private activeConnections = 0;
  private maxConnections: number;
  private requestsPerSecond: number;
  private requestTimestamps: number[] = [];
  private rateLimitedUntil: number = 0;
  private consecutiveFailures: number = 0;
  private maxRetries: number = 3;
  private baseBackoffMs: number = 1000;
  private maxBackoffMs: number = 30000;

  constructor(maxConnections: number = 5, requestsPerSecond: number = 8) {
    this.maxConnections = maxConnections;
    this.requestsPerSecond = requestsPerSecond;
  }

  async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, execute, retryCount: 0, addedAt: Date.now() });
      this.processQueue();
    });
  }

  setRateLimited(retryAfterSeconds: number): void {
    this.rateLimitedUntil = Date.now() + (retryAfterSeconds * 1000);
    console.log(`Provider queue rate limited for ${retryAfterSeconds}s`);
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    if (now < this.rateLimitedUntil) return true;
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 1000);
    return this.requestTimestamps.length >= this.requestsPerSecond;
  }

  private getBackoffDelay(): number {
    if (this.consecutiveFailures === 0) return 0;
    const delay = Math.min(
      this.baseBackoffMs * Math.pow(2, this.consecutiveFailures - 1),
      this.maxBackoffMs
    );
    return delay * (0.75 + Math.random() * 0.5);
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.activeConnections >= this.maxConnections) {
      return;
    }

    const now = Date.now();

    if (now < this.rateLimitedUntil) {
      const waitTime = this.rateLimitedUntil - now;
      setTimeout(() => this.processQueue(), Math.min(waitTime + 100, 5000));
      return;
    }

    if (this.isRateLimited()) {
      setTimeout(() => this.processQueue(), 150);
      return;
    }

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
      this.consecutiveFailures = 0;
      request.resolve(result);
    } catch (error) {
      this.consecutiveFailures++;

      if (request.retryCount < this.maxRetries) {
        request.retryCount++;
        console.log(`Provider request failed, retry ${request.retryCount}/${this.maxRetries}`);
        this.queue.unshift(request);
      } else {
        console.error(`Provider request failed after ${this.maxRetries} retries`);
        request.reject(error as Error);
      }
    } finally {
      this.activeConnections--;
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

  shutdown(): void {
    const pendingRequests = this.queue.splice(0);
    pendingRequests.forEach(req => {
      req.reject(new Error("Queue shutdown"));
    });
  }
}

const providerRequestQueue = new ProviderRequestQueue(5, 8);

// Export for external rate limit notification
export function setProviderRateLimited(retryAfterSeconds: number): void {
  providerRequestQueue.setRateLimited(retryAfterSeconds);
}

async function fetchEmailsFromAccount(
  account: AccountIdentifier,
  targetAddress?: string
): Promise<FetchedProviderEmail[]> {
  const imapConfig = createImapConfig(account.email);
  if (!imapConfig) {
    console.log(`No credentials for account ${account.email}`);
    return [];
  }

  return new Promise<FetchedProviderEmail[]>((resolve) => {
    const imap = new Imap(imapConfig);
    const emails: FetchedProviderEmail[] = [];
    let connectionTimeout: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      try { imap.end(); } catch (e) {}
    };

    const safeResolve = (result: FetchedProviderEmail[]) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    connectionTimeout = setTimeout(() => {
      console.log(`IMAP timeout for ${account.email}`);
      safeResolve([]);
    }, 15000);

    imap.once("ready", () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);

      imap.openBox("INBOX", false, (err, box) => {
        if (err) {
          safeResolve([]);
          return;
        }

        if (!box.messages.total) {
          safeResolve([]);
          return;
        }

        const searchCriteria = targetAddress
          ? [["TO", targetAddress]]
          : ["ALL"];

        imap.search(searchCriteria as any, (searchErr, results) => {
          if (searchErr || !results.length) {
            safeResolve([]);
            return;
          }

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
                    safeResolve(emails);
                  }
                  return;
                }

                const emailId = parsed.messageId || `uid-${account.email}-${uid}`;
                const isAlias = isAliasEmail(toAddress);

                const email: FetchedProviderEmail = {
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
                  provider: account.provider,
                  accountEmail: account.email,
                  isAlias: isAlias,
                  attachments: parsed.attachments?.map((att: Attachment) => ({
                    filename: att.filename || "attachment",
                    contentType: att.contentType,
                    size: att.size,
                  })),
                  rawAttachments: parsed.attachments,
                };

                providerEmailDataCache.set(emailId, {
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
                safeResolve(emails);
              }
            });
          });

          fetch.once("error", () => {
            safeResolve(emails);
          });

          fetch.once("end", () => {
            if (pending === 0) {
              safeResolve(emails);
            }
          });
        });
      });
    });

    imap.once("error", (imapErr: Error) => {
      console.error(`IMAP error for ${account.email}:`, imapErr.message);
      safeResolve([]);
    });

    imap.connect();
  });
}

export async function fetchProviderEmails(
  targetAddress?: string,
  isLoggedIn: boolean = false
): Promise<FetchedProviderEmail[]> {
  const cacheKey = `${targetAddress || "all"}-${isLoggedIn}`;

  const cached = providerEmailCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const accounts = getAllAccountIdentifiers();

  if (accounts.length === 0) {
    return [];
  }

  // Throttle parallel requests - fetch accounts sequentially if many accounts
  // to prevent overwhelming Gmail's rate limits
  let allEmails: FetchedProviderEmail[] = [];

  if (accounts.length <= 3) {
    // Few accounts - parallel is fine
    const fetchPromises = accounts.map((account) =>
      providerRequestQueue.enqueue(() => fetchEmailsFromAccount(account, targetAddress))
    );
    const results = await Promise.all(fetchPromises);
    allEmails = results.flat();
  } else {
    // Many accounts - batch to reduce concurrent load
    const batchSize = 3;
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      const batchPromises = batch.map((account) =>
        providerRequestQueue.enqueue(() => fetchEmailsFromAccount(account, targetAddress))
      );
      const batchResults = await Promise.all(batchPromises);
      allEmails.push(...batchResults.flat());

      // Small delay between batches
      if (i + batchSize < accounts.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  if (!isLoggedIn) {
    allEmails = allEmails.filter((email) => email.isAlias === true);
  }

  allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Limit to top 30 emails (rolling window)
  const limitedEmails = allEmails.slice(0, 30);

  providerEmailCache.set(cacheKey, limitedEmails);
  return limitedEmails;
}

export async function fetchEmailsFromSpecificAccount(
  accountEmail: string,
  targetAddress?: string
): Promise<FetchedProviderEmail[]> {
  const accounts = getAllAccountIdentifiers();
  const account = accounts.find((a) => a.email.toLowerCase() === accountEmail.toLowerCase());

  if (!account) {
    return [];
  }

  return providerRequestQueue.enqueue(() => fetchEmailsFromAccount(account, targetAddress));
}

export function getProviderEmailData(emailId: string): CachedEmailData | undefined {
  return providerEmailDataCache.get(emailId);
}

export function clearProviderCache(): void {
  providerEmailCache.clear();
}

export async function deleteProviderEmail(
  emailId: string,
  accountEmail: string
): Promise<boolean> {
  const imapConfig = createImapConfig(accountEmail);
  if (!imapConfig) {
    return false;
  }

  const cachedData = providerEmailDataCache.get(emailId);

  return providerRequestQueue.enqueue(async () => {
    return new Promise<boolean>((resolve) => {
      const imap = new Imap(imapConfig);
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
            ? [["UID", cachedData.email.uid]]
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
                  providerEmailCache.clear();
                  providerEmailDataCache.delete(emailId);
                  safeResolve(true);
                }
              });
            });
          });
        });
      });

      imap.once("error", () => {
        safeResolve(false);
      });

      imap.connect();
    });
  });
}

export async function getProviderAttachment(
  emailId: string,
  filename: string,
  accountEmail: string
): Promise<{ content: Buffer; contentType: string; filename: string } | null> {
  const cachedData = providerEmailDataCache.get(emailId);

  if (cachedData?.rawAttachments) {
    const attachment = cachedData.rawAttachments.find(
      (att) =>
        att.filename === filename ||
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

  const imapConfig = createImapConfig(accountEmail);
  if (!imapConfig) {
    return null;
  }

  return providerRequestQueue.enqueue(async () => {
    return new Promise<{ content: Buffer; contentType: string; filename: string } | null>((resolve) => {
      const imap = new Imap(imapConfig);
      let resolved = false;

      const safeResolve = (result: { content: Buffer; contentType: string; filename: string } | null) => {
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
                    (att: Attachment) =>
                      att.filename === filename ||
                      att.filename?.toLowerCase() === filename.toLowerCase()
                  );

                  if (attachment) {
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
export function getProviderQueueStats() {
  return providerRequestQueue.getStats();
}

// Graceful shutdown
export function shutdownProviderService(): void {
  console.log("Shutting down provider email service...");
  providerRequestQueue.shutdown();
  console.log("Provider email service shutdown complete");
}

initializeAccounts();
