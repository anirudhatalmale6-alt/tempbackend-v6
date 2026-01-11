import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import MongoStore from "connect-mongo";
import createMemoryStore from "memorystore";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { authLimiter } from "./rate-limiter";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const isProduction = process.env.NODE_ENV === "production";
  
  const mongoUrl = process.env.MONGODB_URI;
  
  let store;
  if (mongoUrl) {
    store = MongoStore.create({
      mongoUrl,
      dbName: "tempmail",
      collectionName: "sessions",
      ttl: sessionTtl / 1000,
      autoRemove: "native",
    });
  } else {
    console.log("MONGODB_URI not set, using memory store for sessions (development mode)");
    const MemoryStore = createMemoryStore(session);
    store = new MemoryStore({
      checkPeriod: 86400000,
    });
  }

  return session({
    secret: process.env.SESSION_SECRET || "dev-secret-key-change-in-production",
    store,
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

export async function setupGoogleAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.warn("Google OAuth credentials not configured. Authentication disabled.");
    
    app.get("/api/login", authLimiter, (req, res) => {
      res.status(503).json({ message: "Google OAuth not configured" });
    });
    
    app.get("/api/auth/google/callback", authLimiter, (req, res) => {
      res.redirect("/");
    });
    
    app.get("/api/logout", authLimiter, (req, res) => {
      res.redirect("/");
    });
    
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: "/api/auth/google/callback",
        passReqToCallback: true,
      },
      async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
        try {
          const user = {
            id: profile.id,
            email: profile.emails?.[0]?.value || "",
            firstName: profile.name?.givenName || "",
            lastName: profile.name?.familyName || "",
            profileImageUrl: profile.photos?.[0]?.value || "",
          };

          await storage.upsertUser(user);

          done(null, {
            id: profile.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
          });
        } catch (error) {
          done(error, null);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  // Use OAuth state parameter to pass mobile flag
  app.get("/api/login", authLimiter, (req, res, next) => {
    const isMobile = req.query.redirect === "mobile";
    
    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
      state: isMobile ? "mobile" : "web",
    })(req, res, next);
  });

  app.get(
    "/api/auth/google/callback",
    authLimiter,
    passport.authenticate("google", {
      failureRedirect: "/?error=auth_failed",
    }),
    async (req: any, res) => {
      const state = req.query.state;
      const isMobile = state === "mobile";
      
      console.log("OAuth callback - state:", state, "isMobile:", isMobile);
      
      if (isMobile) {
        return res.redirect("/api/mobile/callback");
      }
      
      res.redirect("/");
    }
  );

  app.get("/api/logout", authLimiter, (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
      }
      req.session.destroy((err) => {
        if (err) {
          console.error("Session destroy error:", err);
        }
        res.redirect("/");
      });
    });
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};
