import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/theme-toggle";
import { 
  Copy, 
  RefreshCw, 
  Trash2, 
  Mail, 
  Clock, 
  User, 
  ChevronLeft,
  Inbox,
  Shield,
  Zap,
  Check,
  MailOpen,
  Search,
  Paperclip,
  Download,
  Plus,
  ChevronDown,
  Timer,
  Edit3,
  X,
  Globe,
  LogIn,
  LogOut,
  Lock
} from "lucide-react";
import { format, formatDistanceToNow, differenceInSeconds } from "date-fns";
import { SiGoogle, SiTelegram } from "react-icons/si";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { DialogDescription } from "@/components/ui/dialog";
import type { Email, TempEmail, CustomEmail, ProviderAccount, ProviderEmail, ProviderAlias } from "@shared/schema";

function generateRandomPrefix(): string {
  const adjectives = ["swift", "cool", "fast", "smart", "lucky", "happy", "bold", "calm", "brave", "noble"];
  const nouns = ["fox", "wolf", "bear", "hawk", "lion", "tiger", "eagle", "shark", "owl", "falcon"];
  const number = Math.floor(Math.random() * 9999);
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}${number}`;
}

function formatTimeRemaining(expiresAt: string): string {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const seconds = differenceInSeconds(expiry, now);
  
  if (seconds <= 0) return "Expired";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }
  return `${minutes}m remaining`;
}

export default function Home() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [tempEmails, setTempEmails] = useState<TempEmail[]>([]);
  const [activeTempEmail, setActiveTempEmail] = useState<TempEmail | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMobileDetailView, setIsMobileDetailView] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customPrefix, setCustomPrefix] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [isCustomDialogOpen, setIsCustomDialogOpen] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState("");
  const [activeProviderAlias, setActiveProviderAlias] = useState<ProviderAlias | null>(() => {
    try {
      const stored = localStorage.getItem("activeProviderAlias");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [providerAliases, setProviderAliases] = useState<ProviderAlias[]>(() => {
    try {
      const stored = localStorage.getItem("providerAliases");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [inboxMode, setInboxMode] = useState<"domain" | "provider">(() => {
    try {
      const stored = localStorage.getItem("inboxMode");
      return stored === "provider" ? "provider" : "domain";
    } catch {
      return "domain";
    }
  });
  const [activeProviderAccount, setActiveProviderAccount] = useState<ProviderAccount | null>(null);
  const [isProviderAliasDialogOpen, setIsProviderAliasDialogOpen] = useState(false);
  const [customAliasSuffix, setCustomAliasSuffix] = useState("");
  const [isCreatingProviderAlias, setIsCreatingProviderAlias] = useState(false);
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false);
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);

  const { data: domainsData } = useQuery<{ domains: string[] }>({
    queryKey: ["/api/domains"],
  });
  
  const { data: providerAccountsData } = useQuery<{ 
    accounts: ProviderAccount[]; 
    providers: { gmail: boolean; outlook: boolean } 
  }>({
    queryKey: ["/api/provider-accounts"],
  });
  
  const domains = domainsData?.domains || ["codelearnfast.com"];
  
  // Fetch custom emails from MongoDB for logged-in users
  const { data: customEmailsData, isLoading: customEmailsLoading } = useQuery<{ emails: CustomEmail[] }>({
    queryKey: ["/api/custom-emails"],
    enabled: isAuthenticated,
  });

  // State for tracking email creation/deletion in progress
  const [isDeletingEmail, setIsDeletingEmail] = useState<string | null>(null);
  
  useEffect(() => {
    if (domains.length > 0 && !selectedDomain) {
      setSelectedDomain(domains[0]);
    }
  }, [domains, selectedDomain]);

  // Load emails: from MongoDB for logged-in users, localStorage for guests
  useEffect(() => {
    if (authLoading || customEmailsLoading) return;

    if (isAuthenticated && customEmailsData?.emails) {
      // For logged-in users, use MongoDB data
      const mongoEmails = customEmailsData.emails.map(e => ({
        address: e.address,
        createdAt: e.createdAt,
        expiresAt: e.expiresAt,
      }));
      
      const validEmails = mongoEmails.filter(e => {
        if (!e.expiresAt) return true;
        return new Date(e.expiresAt) > new Date();
      });
      
      if (validEmails.length > 0) {
        setTempEmails(validEmails);
        if (!activeTempEmail || !validEmails.find(e => e.address === activeTempEmail.address)) {
          setActiveTempEmail(validEmails[0]);
        }
      } else {
        // No saved emails, create a new one
        if (tempEmails.length === 0) {
          createNewEmail();
        }
      }
    } else if (!isAuthenticated) {
      // For guests, use localStorage
      const stored = localStorage.getItem("tempEmails");
      if (stored) {
        try {
          const emails = JSON.parse(stored) as TempEmail[];
          const validEmails = emails.filter(e => {
            if (!e.expiresAt) return true;
            return new Date(e.expiresAt) > new Date();
          });
          setTempEmails(validEmails);
          if (validEmails.length > 0) {
            setActiveTempEmail(validEmails[0]);
          } else {
            createNewEmail();
          }
        } catch {
          createNewEmail();
        }
      } else {
        createNewEmail();
      }
    }
  }, [authLoading, customEmailsLoading, isAuthenticated, customEmailsData]);

  useEffect(() => {
    if (!activeTempEmail?.expiresAt) return;
    
    const updateTimer = () => {
      setTimeRemaining(formatTimeRemaining(activeTempEmail.expiresAt!));
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [activeTempEmail]);

  const saveTempEmails = useCallback((emails: TempEmail[]) => {
    localStorage.setItem("tempEmails", JSON.stringify(emails));
  }, []);

  // Persist provider aliases to localStorage
  useEffect(() => {
    localStorage.setItem("providerAliases", JSON.stringify(providerAliases));
  }, [providerAliases]);

  useEffect(() => {
    if (activeProviderAlias) {
      localStorage.setItem("activeProviderAlias", JSON.stringify(activeProviderAlias));
    } else {
      localStorage.removeItem("activeProviderAlias");
    }
  }, [activeProviderAlias]);

  useEffect(() => {
    localStorage.setItem("inboxMode", inboxMode);
  }, [inboxMode]);

  const createNewEmail = useCallback(async (prefix?: string, domain?: string): Promise<{ success: boolean; email?: TempEmail; error?: string }> => {
    const emailPrefix = prefix || generateRandomPrefix();
    const emailDomain = domain || selectedDomain || domains[0] || "codelearnfast.com";
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const newEmail: TempEmail = {
      address: `${emailPrefix}@${emailDomain}`,
      createdAt: new Date().toISOString(),
      expiresAt,
    };
    
    // For logged-in users, save to MongoDB first, then update UI on success
    if (isAuthenticated) {
      try {
        const response = await apiRequest("POST", "/api/custom-emails", {
          address: newEmail.address,
          domain: emailDomain,
          prefix: emailPrefix,
          expiresAt,
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          const errorMessage = errorData?.error || "Could not save email. You may have reached the 10-email limit.";
          toast({
            title: "Failed to create email",
            description: errorMessage,
            variant: "destructive",
          });
          return { success: false, error: errorMessage };
        }
        
        // Success - update UI
        setTempEmails(prev => [newEmail, ...prev].slice(0, 10));
        setActiveTempEmail(newEmail);
        setSelectedEmail(null);
        queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
        queryClient.invalidateQueries({ queryKey: ["/api/custom-emails"] });
        return { success: true, email: newEmail };
      } catch (error: any) {
        const errorMessage = "Network error. Please try again.";
        toast({
          title: "Failed to create email",
          description: errorMessage,
          variant: "destructive",
        });
        return { success: false, error: errorMessage };
      }
    } else {
      // For guests, update localStorage immediately
      setTempEmails(prev => {
        const updated = [newEmail, ...prev].slice(0, 10);
        saveTempEmails(updated);
        return updated;
      });
      setActiveTempEmail(newEmail);
      setSelectedEmail(null);
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      return { success: true, email: newEmail };
    }
  }, [saveTempEmails, selectedDomain, domains, isAuthenticated, toast]);

  const switchToEmail = useCallback((email: TempEmail) => {
    setActiveTempEmail(email);
    setSelectedEmail(null);
    queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
  }, []);

  const removeEmail = useCallback(async (emailToRemove: TempEmail) => {
    // For logged-in users, delete from MongoDB first, then update UI on success
    if (isAuthenticated) {
      setIsDeletingEmail(emailToRemove.address);
      try {
        const response = await apiRequest("DELETE", `/api/custom-emails/${encodeURIComponent(emailToRemove.address)}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          toast({
            title: "Failed to delete email",
            description: errorData?.error || "Could not delete. Please try again.",
            variant: "destructive",
          });
          setIsDeletingEmail(null);
          return;
        }
        
        // Success - update UI
        setTempEmails(prev => {
          const updated = prev.filter(e => e.address !== emailToRemove.address);
          if (activeTempEmail?.address === emailToRemove.address) {
            if (updated.length > 0) {
              setActiveTempEmail(updated[0]);
            } else {
              createNewEmail();
            }
          }
          return updated;
        });
        queryClient.invalidateQueries({ queryKey: ["/api/custom-emails"] });
      } catch {
        toast({
          title: "Failed to delete email",
          description: "Network error. Please try again.",
          variant: "destructive",
        });
      }
      setIsDeletingEmail(null);
    } else {
      // For guests, update localStorage immediately
      setTempEmails(prev => {
        const updated = prev.filter(e => e.address !== emailToRemove.address);
        saveTempEmails(updated);
        if (activeTempEmail?.address === emailToRemove.address) {
          if (updated.length > 0) {
            setActiveTempEmail(updated[0]);
          } else {
            createNewEmail();
          }
        }
        return updated;
      });
    }
  }, [activeTempEmail, saveTempEmails, createNewEmail, isAuthenticated, toast]);

  const [isCreatingEmail, setIsCreatingEmail] = useState(false);
  const [isGeneratingRandom, setIsGeneratingRandom] = useState(false);

  // Handler for generating random email (used by dropdown and generate button)
  const handleGenerateRandomEmail = useCallback(async (domain?: string) => {
    if (isGeneratingRandom) return; // Prevent duplicate submissions
    
    setIsGeneratingRandom(true);
    const result = await createNewEmail(undefined, domain);
    setIsGeneratingRandom(false);
    
    if (result.success && result.email) {
      toast({
        title: "Email created",
        description: `${result.email.address} is ready to use.`,
      });
    }
    // Error toast is already shown by createNewEmail for authenticated users
    // For guests, errors shouldn't happen since it's just localStorage
  }, [createNewEmail, toast, isGeneratingRandom]);
  
  const handleCustomEmailCreate = useCallback(async () => {
    if (customPrefix.trim()) {
      const cleanPrefix = customPrefix.toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (cleanPrefix.length >= 3) {
        const domainToUse = selectedDomain || domains[0];
        
        setIsCreatingEmail(true);
        const result = await createNewEmail(cleanPrefix, domainToUse);
        setIsCreatingEmail(false);
        
        if (result.success) {
          setCustomPrefix("");
          setIsCustomDialogOpen(false);
          toast({
            title: "Email created",
            description: `Your custom email ${cleanPrefix}@${domainToUse} is ready.`,
          });
        }
        // Error toast is already shown by createNewEmail
      } else {
        toast({
          title: "Invalid prefix",
          description: "Prefix must be at least 3 characters (letters, numbers, dots, dashes only).",
          variant: "destructive",
        });
      }
    }
  }, [customPrefix, selectedDomain, domains, createNewEmail, toast]);

  const { data: emails = [], isLoading, isRefetching } = useQuery<Email[]>({
    queryKey: ["/api/emails", activeTempEmail?.address],
    queryFn: async () => {
      const response = await fetch(`/api/emails?address=${encodeURIComponent(activeTempEmail?.address || "")}`);
      if (!response.ok) throw new Error("Failed to fetch emails");
      return response.json();
    },
    enabled: !!activeTempEmail?.address && inboxMode === "domain",
    refetchInterval: 5000,
  });

  const providerEmailAddress = activeProviderAlias?.aliasAddress || activeProviderAccount?.email || "";
  
  const currentProviderContext = activeProviderAccount || (activeProviderAlias ? {
    provider: activeProviderAlias.provider,
    email: activeProviderAlias.baseEmail,
  } : null);
  
  const { data: providerEmails = [], isLoading: providerEmailsLoading, isRefetching: providerEmailsRefetching } = useQuery<ProviderEmail[]>({
    queryKey: ["/api/provider-emails", providerEmailAddress],
    queryFn: async () => {
      const response = await fetch(`/api/provider-emails?address=${encodeURIComponent(providerEmailAddress)}`);
      if (!response.ok) throw new Error("Failed to fetch provider emails");
      return response.json();
    },
    enabled: inboxMode === "provider" && (!!activeProviderAlias || !!activeProviderAccount),
    refetchInterval: 5000,
  });

  const generateProviderAlias = useCallback(async (provider: "gmail" | "outlook", baseEmail: string, customSuffix?: string) => {
    try {
      const response = await apiRequest("POST", "/api/provider-alias", {
        provider,
        baseEmail,
        customSuffix,
      });
      
      if (!response.ok) {
        throw new Error("Failed to generate alias");
      }
      
      const data = await response.json();
      const newAlias: ProviderAlias = data.alias;
      
      setProviderAliases(prev => [newAlias, ...prev].slice(0, 10));
      setActiveProviderAlias(newAlias);
      setInboxMode("provider");
      
      toast({
        title: "Alias created",
        description: `${newAlias.aliasAddress} is ready to use.`,
      });
      
      return newAlias;
    } catch {
      toast({
        title: "Error",
        description: "Failed to generate alias. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  const switchToProviderAlias = useCallback((alias: ProviderAlias) => {
    setActiveProviderAlias(alias);
    setActiveProviderAccount(null);
    setInboxMode("provider");
    setSelectedEmail(null);
    queryClient.invalidateQueries({ queryKey: ["/api/provider-emails"] });
  }, []);

  const switchToDomainEmail = useCallback((email: TempEmail) => {
    setActiveTempEmail(email);
    setActiveProviderAccount(null);
    setActiveProviderAlias(null);
    setInboxMode("domain");
    setSelectedEmail(null);
    queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
  }, []);

  const switchToProviderAccount = useCallback((account: ProviderAccount) => {
    // Set provider context so alias generation works for everyone
    setActiveProviderAccount(account);
    setActiveProviderAlias(null);
    setInboxMode("provider");
    setSelectedEmail(null);
    
    // Lock base Gmail/Outlook inbox for guests - require sign in to view emails
    if (!isAuthenticated) {
      setIsSignInDialogOpen(true);
      return; // Don't fetch emails for guests
    }
    
    queryClient.invalidateQueries({ queryKey: ["/api/provider-emails"] });
  }, [isAuthenticated]);

  const handleCustomProviderAliasCreate = useCallback(async () => {
    if (!currentProviderContext) return;
    
    const suffix = customAliasSuffix.trim();
    if (suffix.length < 2) {
      toast({
        title: "Invalid suffix",
        description: "Alias suffix must be at least 2 characters.",
        variant: "destructive",
      });
      return;
    }
    
    setIsCreatingProviderAlias(true);
    try {
      await generateProviderAlias(currentProviderContext.provider, currentProviderContext.email, suffix);
      setIsProviderAliasDialogOpen(false);
      setCustomAliasSuffix("");
    } finally {
      setIsCreatingProviderAlias(false);
    }
  }, [currentProviderContext, customAliasSuffix, generateProviderAlias, toast]);

  const copyCurrentEmailToClipboard = useCallback(async () => {
    let emailToCopy = "";
    if (inboxMode === "domain" && activeTempEmail?.address) {
      emailToCopy = activeTempEmail.address;
    } else if (activeProviderAlias?.aliasAddress) {
      emailToCopy = activeProviderAlias.aliasAddress;
    } else if (activeProviderAccount?.email) {
      emailToCopy = activeProviderAccount.email;
    }
    
    if (emailToCopy) {
      await navigator.clipboard.writeText(emailToCopy);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Email address copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    }
  }, [inboxMode, activeTempEmail, activeProviderAlias, activeProviderAccount, toast]);

  const getCurrentActiveEmail = useCallback((): string => {
    if (inboxMode === "domain") {
      return activeTempEmail?.address || "Loading...";
    } else if (activeProviderAlias) {
      return activeProviderAlias.aliasAddress;
    } else if (activeProviderAccount) {
      return activeProviderAccount.email;
    }
    return "Loading...";
  }, [inboxMode, activeTempEmail, activeProviderAlias, activeProviderAccount]);

  const currentEmails = inboxMode === "domain" ? emails : providerEmails;
  const baseLoading = inboxMode === "domain" ? isLoading : providerEmailsLoading;
  const currentLoading = baseLoading || isForceRefreshing;
  const currentRefetching = isForceRefreshing || (inboxMode === "domain" ? isRefetching : providerEmailsRefetching);

  const filteredEmails = useMemo(() => {
    if (!searchQuery.trim()) return currentEmails;
    const query = searchQuery.toLowerCase();
    return currentEmails.filter(email => 
      email.subject?.toLowerCase().includes(query) ||
      email.from?.toLowerCase().includes(query) ||
      email.fromName?.toLowerCase().includes(query) ||
      email.textContent?.toLowerCase().includes(query)
    );
  }, [currentEmails, searchQuery]);

  const hasProviderAccounts = (providerAccountsData?.accounts?.length || 0) > 0;

  const deleteMutation = useMutation({
    mutationFn: async (emailId: string) => {
      await apiRequest("DELETE", `/api/emails/${emailId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      setSelectedEmail(null);
      setIsMobileDetailView(false);
      toast({
        title: "Email deleted",
        description: "The email has been removed from your inbox.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete email. Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = useCallback(async () => {
    if (activeTempEmail?.address) {
      await navigator.clipboard.writeText(activeTempEmail.address);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Email address copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    }
  }, [activeTempEmail, toast]);

  const handleEmailSelect = (email: Email) => {
    setSelectedEmail(email);
    setIsMobileDetailView(true);
  };

  const handleBackToList = () => {
    setIsMobileDetailView(false);
    setSelectedEmail(null);
  };

  const refreshInbox = useCallback(async () => {
    if (isForceRefreshing) return;
    
    setIsForceRefreshing(true);
    
    try {
      if (inboxMode === "provider") {
        const address = providerEmailAddress;
        if (!address) {
          setIsForceRefreshing(false);
          return;
        }
        
        const response = await fetch(`/api/provider-emails/refresh?address=${encodeURIComponent(address)}`, {
          method: "POST",
          credentials: "include",
        });
        
        if (response.ok) {
          const freshEmails = await response.json();
          queryClient.setQueryData(["/api/provider-emails", address], freshEmails);
        } else {
          throw new Error("Refresh request failed");
        }
      } else {
        const address = activeTempEmail?.address || "";
        if (!address) {
          setIsForceRefreshing(false);
          return;
        }
        
        const response = await fetch(`/api/emails/refresh?address=${encodeURIComponent(address)}`, {
          method: "POST",
          credentials: "include",
        });
        
        if (response.ok) {
          const freshEmails = await response.json();
          queryClient.setQueryData(["/api/emails", address], freshEmails);
        } else {
          throw new Error("Refresh request failed");
        }
      }
    } catch (error) {
      console.error("Refresh failed:", error);
      toast({
        title: "Refresh failed",
        description: "Could not refresh inbox. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsForceRefreshing(false);
    }
  }, [inboxMode, activeTempEmail, providerEmailAddress, isForceRefreshing, toast]);

  const downloadAttachment = async (emailId: string, filename: string) => {
    try {
      const response = await fetch(`/api/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(filename)}`);
      if (!response.ok) throw new Error("Failed to download");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Downloaded",
        description: `${filename} has been downloaded.`,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to download attachment.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex-1 bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary">
              <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-primary-foreground" />
            </div>
            <span className="text-lg sm:text-xl font-semibold">TempMail</span>
          </div>
          <div className="flex items-center gap-2">
            {authLoading ? (
              <Skeleton className="h-9 w-20" />
            ) : isAuthenticated && user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2" data-testid="button-user-menu">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={user.profileImageUrl || undefined} />
                      <AvatarFallback>
                        {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline text-sm">
                      {user.firstName || user.email?.split("@")[0] || "User"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href="/api/logout" data-testid="button-logout">
                      <LogOut className="h-4 w-4 mr-2" />
                      Log out
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button 
                variant="default" 
                size="sm" 
                className="gap-2"
                onClick={() => window.location.href = "/api/login"}
                data-testid="button-login"
              >
                <SiGoogle className="h-4 w-4" />
                <span className="hidden sm:inline">Sign in with Google</span>
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-8">
        <section className="mb-8 sm:mb-12">
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold mb-3 sm:mb-4">
              Free Temporary Email
            </h1>
            <p className="text-sm sm:text-lg text-muted-foreground max-w-2xl mx-auto px-2">
              Get a disposable email address instantly. No registration required. 
              Perfect for protecting your privacy online.
            </p>
          </div>

          <Card className="max-w-2xl mx-auto p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-2">
                  <div className="text-xs sm:text-sm text-muted-foreground font-medium">
                    {inboxMode === "provider" 
                      ? `${currentProviderContext?.provider === "gmail" ? "Gmail" : "Outlook"} Alias`
                      : "Your temporary email address"
                    }
                  </div>
                  {inboxMode === "provider" && (
                    <Badge variant={isAuthenticated ? "secondary" : "outline"} className="text-xs">
                      {isAuthenticated ? "Full inbox" : "Alias only"}
                    </Badge>
                  )}
                </div>
                {inboxMode === "domain" && activeTempEmail?.expiresAt && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Timer className="h-3 w-3" />
                    <span data-testid="text-expiry-timer">{timeRemaining}</span>
                  </div>
                )}
              </div>
              
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex-1 flex items-center gap-3 px-4 py-3 bg-muted rounded-lg border text-left hover-elevate active-elevate-2">
                        {inboxMode === "provider" && currentProviderContext?.provider === "gmail" ? (
                          <SiGoogle className="h-5 w-5 text-red-500 shrink-0" />
                        ) : inboxMode === "provider" && currentProviderContext?.provider === "outlook" ? (
                          <Mail className="h-5 w-5 text-blue-500 shrink-0" />
                        ) : (
                          <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
                        )}
                        <span 
                          className="font-mono text-base sm:text-lg truncate flex-1"
                          data-testid="text-email-address"
                        >
                          {getCurrentActiveEmail()}
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[300px] sm:w-[400px]">
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Domain Emails</div>
                      {tempEmails.map((email) => (
                        <DropdownMenuItem 
                          key={email.address}
                          onClick={() => switchToDomainEmail(email)}
                          className="flex items-center justify-between gap-2"
                          data-testid={`inbox-option-${email.address}`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-mono text-sm truncate">{email.address}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {inboxMode === "domain" && email.address === activeTempEmail?.address && (
                              <Badge variant="secondary" className="text-xs">Active</Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeEmail(email);
                              }}
                              data-testid={`button-remove-inbox-${email.address}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </DropdownMenuItem>
                      ))}
                      <Separator className="my-1" />
                      {domains.map((domain) => (
                        <DropdownMenuItem 
                          key={domain} 
                          onClick={() => handleGenerateRandomEmail(domain)}
                          disabled={isGeneratingRandom}
                          data-testid={`button-generate-${domain}`}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          {isGeneratingRandom ? "Creating..." : `New @${domain}`}
                        </DropdownMenuItem>
                      ))}
                      
                      {hasProviderAccounts && (
                        <>
                          <Separator className="my-1" />
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center justify-between">
                            <span>Gmail & Outlook</span>
                            {!isAuthenticated && <Badge variant="outline" className="text-[10px]">Alias only</Badge>}
                          </div>
                          
                          {providerAccountsData?.accounts?.map(account => (
                            <DropdownMenuItem 
                              key={account.email}
                              onClick={() => switchToProviderAccount(account)}
                              className="flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 truncate">
                                {account.provider === "gmail" ? (
                                  <SiGoogle className="h-4 w-4 text-red-500 shrink-0" />
                                ) : (
                                  <Mail className="h-4 w-4 text-blue-500 shrink-0" />
                                )}
                                <span className="font-mono text-sm truncate">{account.email}</span>
                                {!isAuthenticated && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                              </div>
                              {inboxMode === "provider" && activeProviderAccount?.email === account.email && !activeProviderAlias && (
                                <Badge variant="secondary" className="text-xs">Active</Badge>
                              )}
                            </DropdownMenuItem>
                          ))}
                          
                          {providerAliases.length > 0 && (
                            <>
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">Your Aliases</div>
                              {providerAliases.map(alias => (
                                <DropdownMenuItem 
                                  key={alias.aliasAddress}
                                  onClick={() => switchToProviderAlias(alias)}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {alias.provider === "gmail" ? (
                                      <SiGoogle className="h-4 w-4 text-red-500 shrink-0" />
                                    ) : (
                                      <Mail className="h-4 w-4 text-blue-500 shrink-0" />
                                    )}
                                    <span className="font-mono text-xs truncate">{alias.aliasAddress}</span>
                                  </div>
                                  {inboxMode === "provider" && activeProviderAlias?.aliasAddress === alias.aliasAddress && (
                                    <Badge variant="secondary" className="text-xs">Active</Badge>
                                  )}
                                </DropdownMenuItem>
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <Button 
                      onClick={copyCurrentEmailToClipboard}
                      className="flex-1 sm:flex-none gap-2"
                      size="default"
                      data-testid="button-copy-email"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                    
                    {inboxMode === "domain" ? (
                      <>
                        {isAuthenticated ? (
                          <Dialog open={isCustomDialogOpen} onOpenChange={setIsCustomDialogOpen}>
                            <DialogTrigger asChild>
                              <Button 
                                variant="outline"
                                className="flex-1 sm:flex-none gap-2"
                                size="default"
                                data-testid="button-custom-email"
                              >
                                <Edit3 className="h-4 w-4" />
                                <span className="hidden sm:inline">Custom</span>
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Create Custom Email</DialogTitle>
                                <VisuallyHidden>
                                  <DialogDescription>Choose a custom prefix and domain for your temporary email address</DialogDescription>
                                </VisuallyHidden>
                              </DialogHeader>
                              <div className="py-4 space-y-4">
                                <div>
                                  <label className="text-sm text-muted-foreground mb-2 block">
                                    Choose your email prefix
                                  </label>
                                  <Input
                                    value={customPrefix}
                                    onChange={(e) => setCustomPrefix(e.target.value)}
                                    placeholder="yourname"
                                    data-testid="input-custom-prefix"
                                  />
                                  <p className="text-xs text-muted-foreground mt-2">
                                    Use letters, numbers, dots, or dashes. Minimum 3 characters.
                                  </p>
                                </div>
                                <div>
                                  <label className="text-sm text-muted-foreground mb-2 block">
                                    Select domain
                                  </label>
                                  <Select value={selectedDomain} onValueChange={setSelectedDomain}>
                                    <SelectTrigger data-testid="select-domain">
                                      <SelectValue placeholder="Select a domain" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {domains.map((domain) => (
                                        <SelectItem key={domain} value={domain} data-testid={`domain-option-${domain}`}>
                                          @{domain}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="p-3 bg-muted rounded-lg">
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Globe className="h-4 w-4" />
                                    <span>Preview:</span>
                                  </div>
                                  <div className="font-mono text-base mt-1">
                                    {customPrefix || "yourname"}@{selectedDomain || domains[0]}
                                  </div>
                                </div>
                              </div>
                              <DialogFooter>
                                <DialogClose asChild>
                                  <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button 
                                  onClick={handleCustomEmailCreate} 
                                  disabled={isCreatingEmail}
                                  data-testid="button-create-custom"
                                >
                                  {isCreatingEmail ? "Creating..." : "Create Email"}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <Button 
                            variant="outline"
                            className="flex-1 sm:flex-none gap-2"
                            size="default"
                            onClick={() => {
                              toast({
                                title: "Sign in required",
                                description: "Please sign in to create custom email addresses.",
                              });
                            }}
                            data-testid="button-custom-email-locked"
                          >
                            <Lock className="h-4 w-4" />
                            <span className="hidden sm:inline">Custom</span>
                          </Button>
                        )}
                        
                        <Button 
                          variant="outline" 
                          size="icon"
                          onClick={() => handleGenerateRandomEmail()}
                          disabled={isGeneratingRandom}
                          data-testid="button-generate-email"
                          aria-label="Generate new email"
                        >
                          <RefreshCw className={`h-4 w-4 ${isGeneratingRandom ? "animate-spin" : ""}`} />
                        </Button>
                      </>
                    ) : currentProviderContext && (
                      <>
                        <Button 
                          variant="outline"
                          className="flex-1 sm:flex-none gap-2"
                          size="default"
                          onClick={() => generateProviderAlias(currentProviderContext.provider, currentProviderContext.email)}
                          data-testid="button-generate-alias"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="hidden sm:inline">New Alias</span>
                        </Button>
                        
                        {isAuthenticated ? (
                          <Dialog open={isProviderAliasDialogOpen} onOpenChange={setIsProviderAliasDialogOpen}>
                            <DialogTrigger asChild>
                              <Button 
                                variant="outline"
                                className="flex-1 sm:flex-none gap-2"
                                size="default"
                                data-testid="button-custom-alias"
                              >
                                <Edit3 className="h-4 w-4" />
                                <span className="hidden sm:inline">Custom Alias</span>
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Create Custom Alias</DialogTitle>
                                <VisuallyHidden>
                                  <DialogDescription>Create a custom alias for your Gmail or Outlook account</DialogDescription>
                                </VisuallyHidden>
                              </DialogHeader>
                              <div className="py-4 space-y-4">
                                <div>
                                  <label className="text-sm text-muted-foreground mb-2 block">
                                    Choose your alias suffix
                                  </label>
                                  <Input
                                    value={customAliasSuffix}
                                    onChange={(e) => setCustomAliasSuffix(e.target.value)}
                                    placeholder="myalias"
                                    data-testid="input-custom-alias-suffix"
                                  />
                                  <p className="text-xs text-muted-foreground mt-2">
                                    Use letters, numbers, or underscores. Minimum 2 characters.
                                  </p>
                                </div>
                                <div className="p-3 bg-muted rounded-lg">
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    {currentProviderContext.provider === "gmail" ? (
                                      <SiGoogle className="h-4 w-4 text-red-500" />
                                    ) : (
                                      <Mail className="h-4 w-4 text-blue-500" />
                                    )}
                                    <span>Preview:</span>
                                  </div>
                                  <div className="font-mono text-sm mt-1">
                                    {currentProviderContext.email.replace("@", `+${customAliasSuffix || "myalias"}@`)}
                                  </div>
                                </div>
                              </div>
                              <DialogFooter>
                                <DialogClose asChild>
                                  <Button variant="outline">Cancel</Button>
                                </DialogClose>
                                <Button 
                                  onClick={handleCustomProviderAliasCreate} 
                                  disabled={isCreatingProviderAlias}
                                  data-testid="button-create-custom-alias"
                                >
                                  {isCreatingProviderAlias ? "Creating..." : "Create Alias"}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <Button 
                            variant="outline"
                            className="flex-1 sm:flex-none gap-2"
                            size="default"
                            onClick={() => {
                              toast({
                                title: "Sign in required",
                                description: "Please sign in to create custom aliases.",
                              });
                            }}
                            data-testid="button-custom-alias-locked"
                          >
                            <Lock className="h-4 w-4" />
                            <span className="hidden sm:inline">Custom Alias</span>
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-12 max-w-5xl mx-auto">
          <Card className="p-3 sm:p-4 flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 shrink-0">
              <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base mb-1">Instant Generation</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Get temp email, Gmail alias or Outlook alias instantly</p>
            </div>
          </Card>
          <Card className="p-3 sm:p-4 flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 shrink-0">
              <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base mb-1">No Registration</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Protect your privacy, no signup needed</p>
            </div>
          </Card>
          <Card className="p-3 sm:p-4 flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-red-500/10 shrink-0">
              <SiGoogle className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base mb-1">Temp Gmail Alias</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Create temporary Gmail addresses using + and . tricks</p>
            </div>
          </Card>
          <Card className="p-3 sm:p-4 flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/10 shrink-0">
              <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base mb-1">Temp Outlook Alias</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">Generate unlimited Outlook temporary emails</p>
            </div>
          </Card>
        </section>

        <section className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">Inbox</h2>
              {currentEmails.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {currentEmails.length}
                </Badge>
              )}
              {inboxMode === "provider" && (activeProviderAlias || activeProviderAccount) && (
                <Badge variant="outline" className="ml-1">
                  {(activeProviderAlias?.provider || activeProviderAccount?.provider) === "gmail" ? "Gmail" : "Outlook"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={refreshInbox}
                disabled={currentRefetching}
                data-testid="button-refresh-inbox"
                aria-label="Refresh inbox"
              >
                <RefreshCw className={`h-4 w-4 ${currentRefetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] min-h-[400px] sm:min-h-[500px]">
              <div className={`border-r ${isMobileDetailView ? "hidden lg:block" : "block"}`}>
                <ScrollArea className="h-[400px] sm:h-[500px]">
                  {currentLoading ? (
                    <div className="p-4 space-y-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                          <Skeleton className="h-3 w-1/4" />
                        </div>
                      ))}
                    </div>
                  ) : filteredEmails.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                        <MailOpen className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="font-semibold mb-2">
                        {searchQuery ? "No matching emails" : "No emails yet"}
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-[200px]">
                        {searchQuery 
                          ? "Try a different search term."
                          : "Waiting for incoming messages. The inbox refreshes automatically."
                        }
                      </p>
                    </div>
                  ) : (
                    <div>
                      {filteredEmails.map((email, index) => (
                        <div key={email.id}>
                          <button
                            onClick={() => handleEmailSelect(email)}
                            className={`w-full text-left p-4 hover-elevate active-elevate-2 transition-colors ${
                              selectedEmail?.id === email.id ? "bg-accent" : ""
                            }`}
                            data-testid={`email-list-item-${email.id}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 shrink-0">
                                <User className="h-5 w-5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-medium truncate">
                                    {email.fromName || email.from.split("@")[0]}
                                  </span>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {formatDistanceToNow(new Date(email.date), { addSuffix: true })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium truncate">
                                    {email.subject || "(No subject)"}
                                  </span>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {email.textContent?.slice(0, 80) || "No preview available"}
                                </div>
                              </div>
                            </div>
                          </button>
                          {index < filteredEmails.length - 1 && <Separator />}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>

              <div className={`${!isMobileDetailView && !selectedEmail ? "hidden lg:block" : "block"}`}>
                {selectedEmail ? (
                  <div className="flex flex-col h-[400px] sm:h-[500px]">
                    <div className="flex items-center gap-2 p-4 border-b">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleBackToList}
                        className="lg:hidden"
                        data-testid="button-back-to-list"
                        aria-label="Back to email list"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </Button>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(selectedEmail.id)}
                        disabled={deleteMutation.isPending}
                        data-testid="button-delete-email"
                        aria-label="Delete email"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="p-4 sm:p-6 border-b">
                      <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4" data-testid="text-email-subject">
                        {selectedEmail.subject || "(No subject)"}
                      </h2>
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 shrink-0">
                          <User className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm sm:text-base" data-testid="text-email-from">
                            {selectedEmail.fromName || selectedEmail.from}
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground truncate">
                            {selectedEmail.from}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <Clock className="h-3 w-3" />
                            <span data-testid="text-email-date">
                              {format(new Date(selectedEmail.date), "PPpp")}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                        <div className="mt-4 p-3 bg-muted rounded-lg">
                          <div className="flex items-center gap-2 text-sm font-medium mb-2">
                            <Paperclip className="h-4 w-4" />
                            Attachments ({selectedEmail.attachments.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedEmail.attachments.map((att, idx) => (
                              <Button
                                key={idx}
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => downloadAttachment(selectedEmail.id, att.filename)}
                                data-testid={`button-download-${att.filename}`}
                              >
                                <Download className="h-3 w-3" />
                                <span className="truncate max-w-[150px]">{att.filename}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({Math.round(att.size / 1024)}KB)
                                </span>
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <ScrollArea className="flex-1 p-4 sm:p-6">
                      {selectedEmail.htmlContent ? (
                        <iframe
                          srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;background:#fff;color:#111;word-wrap:break-word;overflow-wrap:break-word;}img{max-width:100%;height:auto;}a{color:#2563eb;}table{max-width:100%;}</style></head><body>${selectedEmail.htmlContent}</body></html>`}
                          className="w-full min-h-[300px] border-0 bg-white rounded-lg"
                          style={{ height: '400px' }}
                          sandbox="allow-same-origin"
                          title="Email content"
                          data-testid="email-content-html"
                        />
                      ) : (
                        <div 
                          className="whitespace-pre-wrap text-sm"
                          data-testid="email-content-text"
                        >
                          {selectedEmail.textContent || "No content"}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[400px] sm:h-[500px] p-6 sm:p-8 text-center">
                    <div className="flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-4">
                      <Mail className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold mb-2">Select an email</h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                      Choose an email from the list to view its contents here.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </section>

        <section className="max-w-4xl mx-auto mt-8 sm:mt-12 mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-semibold text-center mb-6 sm:mb-8">How It Works - Temporary Email, Gmail & Outlook Aliases</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {[
              { step: 1, title: "Get Address", desc: "Copy your temp email, Gmail alias, or Outlook alias" },
              { step: 2, title: "Use It", desc: "Register on websites or services safely" },
              { step: 3, title: "Receive", desc: "Emails appear in your inbox instantly" },
              { step: 4, title: "Done", desc: "Generate unlimited temporary addresses anytime" },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary text-primary-foreground font-bold text-sm sm:text-base mx-auto mb-2 sm:mb-3">
                  {item.step}
                </div>
                <h3 className="font-semibold text-sm sm:text-base mb-1">{item.title}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              TempMail offers free temporary email addresses plus Gmail and Outlook alias generation. 
              Use our temp Gmail generator or temp Outlook email service to protect your real inbox from spam. 
              Perfect for signing up on websites, testing services, or keeping your primary email private.
            </p>
          </div>
        </section>

        <section className="max-w-2xl mx-auto mt-8 sm:mt-12 mb-6 sm:mb-8">
          <Card className="p-6 sm:p-8 bg-gradient-to-br from-[#0088cc]/10 to-[#0088cc]/5 border-[#0088cc]/20">
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
              <div className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#0088cc] shrink-0">
                <SiTelegram className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-lg sm:text-xl font-bold mb-2">Get TempMail on Telegram</h3>
                <p className="text-sm sm:text-base text-muted-foreground mb-4">
                  Access temporary emails directly from Telegram. Generate addresses, receive emails, and manage your inbox - all without leaving the app.
                </p>
                <Button 
                  className="gap-2 bg-[#0088cc] hover:bg-[#0077b5] text-white"
                  onClick={() => window.open("https://t.me/TempMail_Tgbot", "_blank")}
                  data-testid="button-telegram-bot"
                >
                  <SiTelegram className="h-4 w-4" />
                  Open TempMail Bot
                </Button>
              </div>
            </div>
          </Card>
        </section>
      </main>

      <Dialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Sign In Required
            </DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Sign in to access the full Gmail and Outlook inbox</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              To access the full Gmail and Outlook inbox, you need to sign in with your Google account. 
              This helps protect user privacy and prevents unauthorized access.
            </p>
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="flex gap-2">
                <SiGoogle className="h-5 w-5 text-red-500" />
                <Mail className="h-5 w-5 text-blue-500" />
              </div>
              <div className="text-sm">
                <div className="font-medium">Full inbox access</div>
                <div className="text-muted-foreground">See all emails in Gmail & Outlook</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Without signing in, you can still use aliases to receive emails at temporary addresses.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button 
              className="gap-2"
              onClick={() => {
                setIsSignInDialogOpen(false);
                window.location.href = "/api/login";
              }}
            >
              <SiGoogle className="h-4 w-4" />
              Sign in with Google
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
