import { AccountIdentifier, getAllAccountIdentifiers } from "./email-accounts";

export interface GeneratedAlias {
  aliasAddress: string;
  baseEmail: string;
  provider: "gmail" | "outlook";
  displayName: string;
}

function generateRandomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateGmailAlias(baseEmail: string, customSuffix?: string): GeneratedAlias | null {
  const match = baseEmail.match(/^([^@]+)@gmail\.com$/i);
  if (!match) {
    return null;
  }

  const localPart = match[1];
  const suffix = customSuffix || generateRandomSuffix();
  const aliasAddress = `${localPart}+${suffix}@gmail.com`;

  return {
    aliasAddress,
    baseEmail,
    provider: "gmail",
    displayName: `Gmail: ${aliasAddress}`,
  };
}

export function generateGmailDotAlias(baseEmail: string): GeneratedAlias | null {
  const match = baseEmail.match(/^([^@]+)@gmail\.com$/i);
  if (!match) {
    return null;
  }

  const localPart = match[1].replace(/\./g, "");
  
  if (localPart.length < 2) {
    return generateGmailAlias(baseEmail);
  }

  const dotPosition = Math.floor(Math.random() * (localPart.length - 1)) + 1;
  const dottedLocal = localPart.slice(0, dotPosition) + "." + localPart.slice(dotPosition);
  const aliasAddress = `${dottedLocal}@gmail.com`;

  return {
    aliasAddress,
    baseEmail,
    provider: "gmail",
    displayName: `Gmail: ${aliasAddress}`,
  };
}

export function generateOutlookAlias(baseEmail: string, customSuffix?: string): GeneratedAlias | null {
  const match = baseEmail.match(/^([^@]+)@(outlook\.com|hotmail\.com)$/i);
  if (!match) {
    return null;
  }

  const localPart = match[1];
  const domain = match[2];
  const suffix = customSuffix || generateRandomSuffix();
  const aliasAddress = `${localPart}+${suffix}@${domain}`;

  return {
    aliasAddress,
    baseEmail,
    provider: "outlook",
    displayName: `Outlook: ${aliasAddress}`,
  };
}

export function generateAliasForAccount(account: AccountIdentifier, customSuffix?: string): GeneratedAlias | null {
  if (account.provider === "gmail") {
    return generateGmailAlias(account.email, customSuffix);
  } else if (account.provider === "outlook") {
    return generateOutlookAlias(account.email, customSuffix);
  }
  return null;
}

export function generateRandomAliases(count: number = 5): GeneratedAlias[] {
  const accounts = getAllAccountIdentifiers();
  const aliases: GeneratedAlias[] = [];

  for (let i = 0; i < count; i++) {
    const account = accounts[Math.floor(Math.random() * accounts.length)];
    if (account) {
      const alias = generateAliasForAccount(account);
      if (alias) {
        aliases.push(alias);
      }
    }
  }

  return aliases;
}

export function getAvailableProviders(): { gmail: boolean; outlook: boolean } {
  const accounts = getAllAccountIdentifiers();
  return {
    gmail: accounts.some((acc) => acc.provider === "gmail"),
    outlook: accounts.some((acc) => acc.provider === "outlook"),
  };
}

export function parseAliasToBase(aliasAddress: string): { baseEmail: string; suffix: string } | null {
  const plusMatch = aliasAddress.match(/^([^+]+)\+([^@]+)@(.+)$/);
  if (plusMatch) {
    return {
      baseEmail: `${plusMatch[1]}@${plusMatch[3]}`,
      suffix: plusMatch[2],
    };
  }
  return null;
}
