# IMAP Email Fetching Optimization

This document describes the optimizations made to stabilize and improve the IMAP email fetching system.

## Problem Summary

The original system had several issues under load:
1. **IMAP connection timeouts** - Connections would timeout without proper retry logic
2. **Rate limiting (429 errors)** - Gmail's rate limits were not being respected
3. **IDLE notification bursts** - New email notifications triggered cascading request bursts
4. **Container crashes** - No graceful shutdown handling led to crashes during IMAP spikes

## Key Fixes Applied

### 1. Exponential Back-off with Jitter

**File:** `server/email-service.ts`

The request queue now implements exponential back-off with jitter:
- Base delay: 1 second
- Maximum delay: 30 seconds
- Jitter: ±25% to prevent thundering herd
- Up to 3 retry attempts per request

```typescript
const delay = Math.min(
  baseBackoffMs * Math.pow(2, consecutiveFailures - 1),
  maxBackoffMs
);
// Add jitter (±25%)
return delay * (0.75 + Math.random() * 0.5);
```

### 2. Rate Limit Awareness

**Files:** `server/email-service.ts`, `server/rate-limiter.ts`

When the API returns 429 (Too Many Requests), the system now:
- Extracts the `retryAfter` value from the response
- Pauses the IMAP request queue for that duration
- Propagates back-pressure from API rate limiter to IMAP queue

```typescript
// In rate-limiter.ts
if (this.notifyEmailService) {
  setEmailServiceRateLimited(retryAfter);
}
```

### 3. IDLE Notification with Immediate Cache Invalidation

**File:** `server/email-service.ts`

IDLE notifications (new email/delete events) now:
- **Immediately invalidate cache** so next API request fetches fresh data
- Debounce notification callbacks (3-second window) to prevent burst of WebSocket notifications
- Result: New emails appear within seconds of arrival

```typescript
const IDLE_DEBOUNCE_MS = 3000;
persistentImap.on("mail", () => {
  // Immediately invalidate cache so next request fetches fresh
  allEmailsCacheTime = 0;
  // Debounce the notification callbacks
  idleNotificationTimeout = setTimeout(() => {
    clearCache();
    notifyEmailUpdate();
  }, IDLE_DEBOUNCE_MS);
});
```

### 4. Enhanced IMAP Reconnection

**File:** `server/email-service.ts`

Persistent IMAP connections now have intelligent reconnection:
- Up to 10 reconnection attempts
- Exponential back-off between attempts (1s to 60s max)
- After max attempts, wait 5 minutes then retry
- Reset attempt counter on successful connection

### 5. Graceful Shutdown

**File:** `server/index.ts`

The server now handles shutdown signals properly:
- Handles SIGTERM and SIGINT
- Stops accepting new connections
- Cleans up IMAP connections
- Drains request queues
- 10-second timeout before force exit

### 6. Safe Promise Resolution

All IMAP operations now use safe resolve/reject patterns:
- Prevent double resolution
- Proper timeout cleanup
- Always close IMAP connections in finally blocks

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EMAIL_USER` | Gmail address for single-account mode | - |
| `EMAIL_PASSWORD` | Gmail app password | - |
| `GMAIL_ACCOUNTS` | Multi-account format: `email1:pass1:email2:pass2` | - |
| `OUTLOOK_ACCOUNTS` | Multi-account format: `email1:pass1:email2:pass2` | - |

### Tunable Parameters

In `email-service.ts`:
```typescript
const ALL_EMAILS_CACHE_TTL = 10000;  // 10 seconds cache for all emails
const emailCache TTL = 10000;         // 10 seconds cache for filtered results
const IDLE_DEBOUNCE_MS = 3000;        // 3 seconds debounce for IDLE notifications
const fetchRateLimit = 2000;          // Minimum 2 seconds between IMAP fetches
```

In `multi-account-email-service.ts`:
```typescript
const providerRequestQueue = new ProviderRequestQueue(5, 8); // Max 5 concurrent, 8 req/sec
```

In `rate-limiter.ts`:
```typescript
apiRateLimiter: 100 requests per minute
emailRateLimiter: 30 requests per minute
authRateLimiter: 10 requests per minute
```

## Monitoring

### Queue Stats Endpoint

`GET /api/stats` returns:
```json
{
  "queue": {
    "queueLength": 0,
    "activeConnections": 1,
    "maxConnections": 3,
    "consecutiveFailures": 0,
    "rateLimitedUntil": null
  },
  "timestamp": "2024-01-11T12:00:00.000Z"
}
```

### Key Metrics to Watch

1. **queueLength** - Should stay low; high values indicate back-pressure
2. **consecutiveFailures** - Indicates IMAP connectivity issues
3. **rateLimitedUntil** - Shows if rate limiting is active

## Reproducing Original Failures

To reproduce the original timeout/crash behavior:

1. Set very aggressive rate limits:
```typescript
const requestQueue = new RequestQueue(10, 100); // Too aggressive
```

2. Remove debouncing:
```typescript
// In IDLE handlers, directly call:
clearCache();
notifyEmailUpdate();
```

3. Remove retry logic:
```typescript
this.maxRetries = 0;
```

## Testing the Fix

1. Start the server and monitor logs
2. Send multiple emails in rapid succession to trigger IDLE
3. Observe:
   - No "IMAP connection timeout" spam
   - Proper exponential back-off messages
   - Rate limit cooldown messages when hitting limits
   - Clean shutdown on SIGTERM

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────┐
│   API Request   │───▶│   Rate Limiter   │───▶│   Request   │
│   /api/emails   │    │  (429 handling)  │    │    Queue    │
└─────────────────┘    └──────────────────┘    └──────┬──────┘
                                                      │
                              ┌────────────────────────┘
                              ▼
                    ┌───────────────────┐
                    │  IMAP Connection  │
                    │  (with backoff)   │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌────────┐     ┌─────────┐     ┌─────────┐
         │  Fetch │     │  IDLE   │     │  Delete │
         │ Emails │     │  Mode   │     │  Email  │
         └────────┘     └────┬────┘     └─────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Debounced     │
                    │  Notification   │
                    └─────────────────┘
```

## Files Modified

- `server/email-service.ts` - Main IMAP service with retry/backoff
- `server/multi-account-email-service.ts` - Multi-account support with same fixes
- `server/rate-limiter.ts` - Rate limiting with back-pressure propagation
- `server/index.ts` - Graceful shutdown handling
