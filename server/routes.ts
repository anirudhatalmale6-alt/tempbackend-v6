import type { Express } from "express";
import { type Server } from "http";
import {
  fetchEmails,
  deleteEmail,
  clearCache,
  getAttachment,
  getQueueStats
} from "./email-service";
import {
  fetchProviderEmails,
  deleteProviderEmail,
  clearProviderCache,
  getProviderAttachment,
} from "./multi-account-email-service";
import {
  getAllAccountIdentifiers,
  getAccountsForVisibility,
} from "./email-accounts";
import {
  generateGmailAlias,
  generateGmailDotAlias,
  generateOutlookAlias,
  getAvailableProviders,
} from "./email-alias";
import { saveContactSubmission } from "./mongodb";
import { setupGoogleAuth, isAuthenticated } from "./googleAuth";
import { storage } from "./storage";
import {
  apiLimiter,
  emailLimiter,
  authLimiter
} from "./rate-limiter";

const BASE_URL = "https://tempmailget.com";

const AVAILABLE_DOMAINS = [
  "codelearnfast.com"
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  /* ---------------- GLOBAL MIDDLEWARE ---------------- */

  app.use("/api", apiLimiter);

  await setupGoogleAuth(app);

  /* ---------------- AUTH ---------------- */

  app.get("/api/auth/user", async (req: any, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.json({ user: null });
      }

      const user = await storage.getUser(req.user.id);

      res.json({
        user: user || {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          profileImageUrl: req.user.profileImageUrl
        }
      });
    } catch (err) {
      console.error(err);
      res.json({ user: null });
    }
  });

  /* ---------------- MOBILE AUTH ENDPOINTS ---------------- */

  app.get("/api/mobile/callback", isAuthenticated, async (req: any, res) => {
    try {
      const code = await storage.saveMobileAuthCode(req.user.id);

      res.redirect(`tempmailflutter://auth?code=${code}`);
    } catch (err) {
      console.error("Mobile callback error:", err);
      res.redirect("tempmailflutter://auth?error=callback_failed");
    }
  });

  // FIXED: Mobile session endpoint now explicitly sends session cookie
  app.post("/api/mobile/session", authLimiter, async (req: any, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ error: "Missing code" });
      }

      const userId = await storage.validateMobileAuthCode(code);

      if (!userId) {
        return res.status(401).json({ error: "Invalid or expired code" });
      }

      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      req.login({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      }, (err: any) => {
        if (err) {
          console.error("Mobile session login error:", err);
          return res.status(500).json({ error: "Session creation failed" });
        }

        // CRITICAL FIX: Save session and ensure cookie is sent
        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ error: "Session save failed" });
          }

          console.log("Mobile session created successfully for user:", user.email);
          console.log("Session ID:", req.sessionID);
          
          res.json({ success: true });
        });
      });
    } catch (err) {
      console.error("Mobile session error:", err);
      res.status(500).json({ error: "Session creation failed" });
    }
  });

  /* ---------------- DOMAINS ---------------- */

  app.get("/api/domains", (req, res) => {
    res.json({ domains: AVAILABLE_DOMAINS });
  });

  /* ---------------- CUSTOM EMAILS ---------------- */

  app.get("/api/custom-emails", isAuthenticated, async (req: any, res) => {
    try {
      const emails = await storage.getCustomEmails(req.user.id);
      res.json({ emails });
    } catch {
      res.status(500).json({ error: "Failed to fetch custom emails" });
    }
  });

  app.post("/api/custom-emails", isAuthenticated, async (req: any, res) => {
    try {
      const { address, domain, prefix, expiresAt } = req.body;

      if (!address || !domain || !prefix) {
        return res.status(400).json({ error: "Missing fields" });
      }

      if (!AVAILABLE_DOMAINS.includes(domain)) {
        return res.status(400).json({ error: "Invalid domain" });
      }

      const existing = await storage.getCustomEmails(req.user.id);
      if (existing.length >= 10) {
        return res.status(400).json({ error: "Max 10 emails allowed" });
      }

      const email = await storage.addCustomEmail({
        userId: req.user.id,
        address,
        domain,
        prefix,
        createdAt: new Date().toISOString(),
        expiresAt
      });

      res.json({ email });
    } catch {
      res.status(500).json({ error: "Failed to add email" });
    }
  });

  app.delete("/api/custom-emails/:address", isAuthenticated, async (req: any, res) => {
    try {
      const address = decodeURIComponent(req.params.address);
      const success = await storage.deleteCustomEmail(req.user.id, address);
      success
        ? res.json({ success: true })
        : res.status(404).json({ error: "Not found" });
    } catch {
      res.status(500).json({ error: "Delete failed" });
    }
  });

  /* ---------------- EMAIL INBOX ---------------- */

  app.get("/api/emails", emailLimiter, async (req, res) => {
    try {
      const emails = await fetchEmails(req.query.address as string | undefined);
      res.json(emails);
    } catch {
      res.status(500).json({ error: "Failed to fetch emails" });
    }
  });

  app.delete("/api/emails/:id", emailLimiter, async (req, res) => {
    try {
      const id = decodeURIComponent(req.params.id);
      const success = await deleteEmail(id);
      success
        ? res.json({ success: true })
        : res.status(404).json({ error: "Email not found" });
    } catch {
      res.status(500).json({ error: "Delete failed" });
    }
  });

  app.post("/api/emails/refresh", emailLimiter, async (req, res) => {
    try {
      clearCache();
      const emails = await fetchEmails(req.query.address as string | undefined);
      res.json(emails);
    } catch {
      res.status(500).json({ error: "Refresh failed" });
    }
  });

  app.get("/api/emails/:id/attachments/:filename", emailLimiter, async (req, res) => {
    try {
      const attachment = await getAttachment(
        decodeURIComponent(req.params.id),
        decodeURIComponent(req.params.filename)
      );

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      res.setHeader("Content-Type", attachment.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${attachment.filename}"`
      );
      res.send(attachment.content);
    } catch {
      res.status(500).json({ error: "Download failed" });
    }
  });

  /* ---------------- PROVIDER ACCOUNTS (Gmail/Outlook) ---------------- */

  app.get("/api/provider-accounts", (req: any, res) => {
    try {
      const isLoggedIn = req.isAuthenticated?.() || false;
      const { aliasAccounts, directAccounts } = getAccountsForVisibility(isLoggedIn);
      
      const accounts = aliasAccounts.map((acc) => ({
        email: acc.email,
        provider: acc.provider,
        canGenerateAlias: true,
        isDirectInbox: directAccounts.some((d) => d.email === acc.email),
      }));

      res.json({ accounts, providers: getAvailableProviders() });
    } catch {
      res.status(500).json({ error: "Failed to fetch provider accounts" });
    }
  });

  app.post("/api/provider-alias", emailLimiter, (req: any, res) => {
    try {
      const { provider, baseEmail, customSuffix, useDotMethod } = req.body;

      if (!provider || !baseEmail) {
        return res.status(400).json({ error: "Missing provider or baseEmail" });
      }

      let alias;
      if (provider === "gmail") {
        if (useDotMethod) {
          alias = generateGmailDotAlias(baseEmail);
        } else if (Math.random() > 0.5 && !customSuffix) {
          alias = generateGmailDotAlias(baseEmail);
        } else {
          alias = generateGmailAlias(baseEmail, customSuffix);
        }
      } else if (provider === "outlook") {
        alias = generateOutlookAlias(baseEmail, customSuffix);
      } else {
        return res.status(400).json({ error: "Invalid provider" });
      }

      if (!alias) {
        return res.status(400).json({ error: "Could not generate alias" });
      }

      res.json({ alias });
    } catch {
      res.status(500).json({ error: "Failed to generate alias" });
    }
  });

  app.get("/api/provider-emails", emailLimiter, async (req: any, res) => {
    try {
      const isLoggedIn = req.isAuthenticated?.() || false;
      const targetAddress = req.query.address as string | undefined;
      
      const emails = await fetchProviderEmails(targetAddress, isLoggedIn);
      res.json(emails);
    } catch {
      res.status(500).json({ error: "Failed to fetch provider emails" });
    }
  });

  app.delete("/api/provider-emails/:id", emailLimiter, async (req: any, res) => {
    try {
      const id = decodeURIComponent(req.params.id);
      const accountEmail = req.query.accountEmail as string;
      
      if (!accountEmail) {
        return res.status(400).json({ error: "Missing accountEmail" });
      }

      const success = await deleteProviderEmail(id, accountEmail);
      success
        ? res.json({ success: true })
        : res.status(404).json({ error: "Email not found" });
    } catch {
      res.status(500).json({ error: "Delete failed" });
    }
  });

  app.post("/api/provider-emails/refresh", emailLimiter, async (req: any, res) => {
    try {
      clearProviderCache();
      const isLoggedIn = req.isAuthenticated?.() || false;
      const targetAddress = req.query.address as string | undefined;
      
      const emails = await fetchProviderEmails(targetAddress, isLoggedIn);
      res.json(emails);
    } catch {
      res.status(500).json({ error: "Refresh failed" });
    }
  });

  app.get("/api/provider-emails/:id/attachments/:filename", emailLimiter, async (req, res) => {
    try {
      const accountEmail = req.query.accountEmail as string;
      
      if (!accountEmail) {
        return res.status(400).json({ error: "Missing accountEmail" });
      }

      const attachment = await getProviderAttachment(
        decodeURIComponent(req.params.id),
        decodeURIComponent(req.params.filename),
        accountEmail
      );

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      res.setHeader("Content-Type", attachment.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${attachment.filename}"`
      );
      res.send(attachment.content);
    } catch {
      res.status(500).json({ error: "Download failed" });
    }
  });

  /* ---------------- CONTACT ---------------- */

  app.post("/api/contact", async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;

      if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: "All fields required" });
      }

      const id = await saveContactSubmission({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        subject: subject.trim(),
        message: message.trim()
      });

      res.json({ success: true, id });
    } catch {
      res.status(500).json({ error: "Submission failed" });
    }
  });

  /* ---------------- HEALTH & STATS ---------------- */

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      domain: "tempmailget.com"
    });
  });

  app.get("/api/stats", (req, res) => {
    res.json({
      queue: getQueueStats(),
      timestamp: new Date().toISOString()
    });
  });

  /* ---------------- SITEMAP (FINAL FIXED) ---------------- */

  app.get("/sitemap.xml", (req, res) => {
    const today = new Date().toISOString().split("T")[0];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <priority>1.0</priority>
  </url>

  <url>
    <loc>${BASE_URL}/blog</loc>
    <priority>0.9</priority>
  </url>

  <url>
    <loc>${BASE_URL}/blog/what-is-temporary-email</loc>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>${BASE_URL}/blog/protect-privacy-with-disposable-email</loc>
    <priority>0.8</priority>
  </url>

  <url>
    <loc>${BASE_URL}/privacy</loc>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>${BASE_URL}/terms</loc>
    <priority>0.7</priority>
  </url>

  <url>
    <loc>${BASE_URL}/contact</loc>
    <priority>0.6</priority>
  </url>

</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.send(sitemap);
  });

  return httpServer;
}
