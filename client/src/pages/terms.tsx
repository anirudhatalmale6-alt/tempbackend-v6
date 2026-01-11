import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="flex-1 bg-gradient-to-br from-background via-background to-muted/30">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl">Terms and Conditions</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Last updated: December 11, 2025
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-6 space-y-6">
            <section>
              <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing and using TempMail ("the Service"), you accept and agree to be bound by these 
                Terms and Conditions. If you do not agree to these terms, please do not use our Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
              <p className="text-muted-foreground leading-relaxed">
                TempMail provides free temporary and disposable email addresses. These email addresses 
                are designed for short-term use and automatically expire after 24 hours. The Service 
                allows users to receive emails without revealing their personal email address.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">3. Acceptable Use</h2>
              <p className="text-muted-foreground leading-relaxed mb-3">
                You agree to use the Service only for lawful purposes. You must NOT use our Service to:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Engage in any illegal activities or fraud</li>
                <li>Send spam, phishing emails, or malware</li>
                <li>Harass, abuse, or harm others</li>
                <li>Violate any applicable laws or regulations</li>
                <li>Infringe on intellectual property rights</li>
                <li>Attempt to gain unauthorized access to our systems</li>
                <li>Create accounts for illegal services or activities</li>
                <li>Bypass security measures of other websites or services</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">4. No Guarantee of Service</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service is provided "as is" without warranties of any kind. We do not guarantee that:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
                <li>The Service will be available at all times</li>
                <li>All emails will be received or delivered</li>
                <li>The Service will be error-free or uninterrupted</li>
                <li>Data will be preserved for any specific duration</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">5. Email Retention</h2>
              <p className="text-muted-foreground leading-relaxed">
                All emails received through our Service are automatically deleted after 24 hours. 
                We are not responsible for any loss of data or emails. Users should not rely on 
                our Service for important or sensitive communications.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">6. Intellectual Property</h2>
              <p className="text-muted-foreground leading-relaxed">
                The TempMail name, logo, website design, and all related content are protected by 
                intellectual property laws. You may not copy, modify, distribute, or reproduce any 
                part of our Service without prior written consent.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">7. Third-Party Links and Services</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our Service may contain links to third-party websites or services. We are not 
                responsible for the content, privacy policies, or practices of these third parties. 
                Your use of third-party services is at your own risk.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">8. Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                To the maximum extent permitted by law, TempMail and its operators shall not be 
                liable for any indirect, incidental, special, consequential, or punitive damages 
                arising from your use of the Service. This includes but is not limited to loss of 
                data, profits, or business opportunities.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">9. Indemnification</h2>
              <p className="text-muted-foreground leading-relaxed">
                You agree to indemnify and hold harmless TempMail, its operators, affiliates, and 
                partners from any claims, damages, losses, or expenses arising from your use of 
                the Service or violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">10. Termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to terminate or suspend access to our Service immediately, 
                without prior notice, for any reason, including breach of these Terms. Upon 
                termination, your right to use the Service will cease immediately.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">11. Changes to Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify these Terms at any time. Changes will be effective 
                immediately upon posting. Your continued use of the Service after changes constitutes 
                acceptance of the modified Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">12. Governing Law</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms shall be governed by and construed in accordance with applicable laws, 
                without regard to conflict of law principles.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">13. Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about these Terms, please visit our{" "}
                <Link href="/contact" className="text-primary hover:underline">
                  Contact Page
                </Link>.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
