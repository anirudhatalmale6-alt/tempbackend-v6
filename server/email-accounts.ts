import Imap from "imap";

export type EmailProvider = "gmail" | "outlook";

export interface AccountIdentifier {
  email: string;
  provider: EmailProvider;
  imapHost: string;
  imapPort: number;
}

export interface ParsedAccounts {
  gmail: AccountIdentifier[];
  outlook: AccountIdentifier[];
}

const credentialCache = new Map<string, string>();

function parseAccountString(accountStr: string, provider: EmailProvider): AccountIdentifier[] {
  if (!accountStr || !accountStr.trim()) {
    return [];
  }

  const accounts: AccountIdentifier[] = [];
  const parts = accountStr.split(":");
  
  for (let i = 0; i < parts.length - 1; i += 2) {
    const email = parts[i]?.trim();
    const password = parts[i + 1]?.trim();
    
    if (email && password) {
      credentialCache.set(email.toLowerCase(), password);
      
      accounts.push({
        email,
        provider,
        imapHost: provider === "gmail" ? "imap.gmail.com" : "outlook.office365.com",
        imapPort: 993,
      });
    }
  }

  return accounts;
}

let parsedAccounts: ParsedAccounts | null = null;

export function initializeAccounts(): void {
  const gmailStr = process.env.GMAIL_ACCOUNTS || "";
  const outlookStr = process.env.OUTLOOK_ACCOUNTS || "";

  const gmailAccounts = parseAccountString(gmailStr, "gmail");
  const outlookAccounts = parseAccountString(outlookStr, "outlook");

  if (gmailAccounts.length === 0 && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
    const email = process.env.EMAIL_USER;
    credentialCache.set(email.toLowerCase(), process.env.EMAIL_PASSWORD);
    gmailAccounts.push({
      email,
      provider: "gmail",
      imapHost: "imap.gmail.com",
      imapPort: 993,
    });
  }

  parsedAccounts = {
    gmail: gmailAccounts,
    outlook: outlookAccounts,
  };
  
  console.log(`Initialized ${gmailAccounts.length} Gmail and ${outlookAccounts.length} Outlook accounts`);
}

export function getAccountIdentifiers(): ParsedAccounts {
  if (!parsedAccounts) {
    initializeAccounts();
  }
  return parsedAccounts!;
}

export function getAllAccountIdentifiers(): AccountIdentifier[] {
  const { gmail, outlook } = getAccountIdentifiers();
  return [...gmail, ...outlook];
}

export function createImapConfig(accountEmail: string): Imap.Config | null {
  const password = credentialCache.get(accountEmail.toLowerCase());
  if (!password) {
    return null;
  }

  const account = getAllAccountIdentifiers().find(
    (acc) => acc.email.toLowerCase() === accountEmail.toLowerCase()
  );
  
  if (!account) {
    return null;
  }

  return {
    user: account.email,
    password,
    host: account.imapHost,
    port: account.imapPort,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    keepalive: true,
    authTimeout: 10000,
    connTimeout: 15000,
  };
}

export function getBaseEmailFromAlias(aliasAddress: string): { baseEmail: string; provider: EmailProvider } | null {
  const allAccounts = getAllAccountIdentifiers();
  const lowerAlias = aliasAddress.toLowerCase();

  for (const account of allAccounts) {
    const [localPart, domain] = account.email.toLowerCase().split("@");
    
    if (account.provider === "gmail") {
      const aliasMatch = lowerAlias.match(/^([^@]+)@(gmail\.com)$/i);
      if (aliasMatch) {
        const aliasLocal = aliasMatch[1];
        const baseLocal = localPart.replace(/\./g, "");
        const cleanAliasLocal = aliasLocal.split("+")[0].replace(/\./g, "");
        
        if (cleanAliasLocal === baseLocal) {
          return { baseEmail: account.email, provider: "gmail" };
        }
      }
    }
    
    if (account.provider === "outlook") {
      const aliasMatch = lowerAlias.match(/^([^@]+)@(outlook\.com|hotmail\.com)$/i);
      if (aliasMatch) {
        const aliasLocal = aliasMatch[1];
        const cleanAliasLocal = aliasLocal.split("+")[0];
        
        if (cleanAliasLocal === localPart) {
          return { baseEmail: account.email, provider: "outlook" };
        }
      }
    }
  }

  return null;
}

export function isAliasEmail(address: string): boolean {
  const lowerAddr = address.toLowerCase();
  
  if (lowerAddr.includes("+")) {
    return true;
  }
  
  const allAccounts = getAllAccountIdentifiers();
  for (const account of allAccounts) {
    if (lowerAddr === account.email.toLowerCase()) {
      return false;
    }
  }
  
  const baseInfo = getBaseEmailFromAlias(address);
  return baseInfo !== null;
}

export function getAccountsForVisibility(isLoggedIn: boolean): {
  aliasAccounts: AccountIdentifier[];
  directAccounts: AccountIdentifier[];
} {
  const allAccounts = getAllAccountIdentifiers();
  
  if (isLoggedIn) {
    return {
      aliasAccounts: allAccounts,
      directAccounts: allAccounts,
    };
  }
  
  return {
    aliasAccounts: allAccounts,
    directAccounts: [],
  };
}

export function hasCredentials(accountEmail: string): boolean {
  return credentialCache.has(accountEmail.toLowerCase());
}
