import { Request, Response, NextFunction } from "express";
import { setRateLimited as setEmailServiceRateLimited } from "./email-service";

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private store: Map<string, RateLimitRecord> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private notifyEmailService: boolean;

  constructor(windowMs: number = 60000, maxRequests: number = 100, notifyEmailService: boolean = false) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.notifyEmailService = notifyEmailService;

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private getKey(req: Request): string {
    // Use IP address as the key, with fallback
    const forwarded = req.headers["x-forwarded-for"];
    const ip = typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.ip || req.socket.remoteAddress || "unknown";
    return ip;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key);
      }
    }
  }

  isRateLimited(req: Request): { limited: boolean; remaining: number; resetTime: number; retryAfter: number } {
    const key = this.getKey(req);
    const now = Date.now();

    let record = this.store.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 0,
        resetTime: now + this.windowMs,
      };
    }

    record.count++;
    this.store.set(key, record);

    const remaining = Math.max(0, this.maxRequests - record.count);
    const limited = record.count > this.maxRequests;
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    return { limited, remaining, resetTime: record.resetTime, retryAfter };
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const { limited, remaining, resetTime, retryAfter } = this.isRateLimited(req);

      res.setHeader("X-RateLimit-Limit", this.maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

      if (limited) {
        // Notify email service about rate limiting so it can back off
        if (this.notifyEmailService) {
          try {
            setEmailServiceRateLimited(retryAfter);
          } catch (e) {
            // Ignore if email service not ready
          }
        }

        res.setHeader("Retry-After", retryAfter.toString());
        return res.status(429).json({
          error: "Too many requests",
          message: "Please wait before making more requests",
          retryAfter: retryAfter,
        });
      }

      next();
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// General API rate limiter: 100 requests per minute
export const apiRateLimiter = new RateLimiter(60000, 100, false);

// Strict rate limiter for email operations: 30 requests per minute
// notifyEmailService=true to propagate back-pressure to IMAP queue
export const emailRateLimiter = new RateLimiter(60000, 30, true);

// Very strict rate limiter for auth: 10 requests per minute
export const authRateLimiter = new RateLimiter(60000, 10, false);

// Middleware exports
export const apiLimiter = apiRateLimiter.middleware();
export const emailLimiter = emailRateLimiter.middleware();
export const authLimiter = authRateLimiter.middleware();
