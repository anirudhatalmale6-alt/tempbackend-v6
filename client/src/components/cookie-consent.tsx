import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie, X } from "lucide-react";
import { Link } from "wouter";

const COOKIE_CONSENT_KEY = "tempmail_cookie_consent";

export function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      // Show banner after a short delay for better UX
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    setIsVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom duration-300"
      data-testid="cookie-consent-banner"
    >
      <div className="container max-w-4xl mx-auto">
        <div className="bg-card border rounded-lg shadow-lg p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Cookie className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm md:text-base mb-1">
                  We use cookies
                </h3>
                <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                  We use cookies to enhance your experience, analyze site traffic, and serve personalized ads. 
                  By clicking "Accept", you consent to our use of cookies. Read our{" "}
                  <Link href="/privacy" className="text-primary hover:underline">
                    Privacy Policy
                  </Link>{" "}
                  for more information.
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDecline}
                data-testid="button-cookie-decline"
              >
                Decline
              </Button>
              <Button
                size="sm"
                onClick={handleAccept}
                data-testid="button-cookie-accept"
              >
                Accept All
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
