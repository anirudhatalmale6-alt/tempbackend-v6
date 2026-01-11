import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Clock, User } from "lucide-react";
import { Link, useRoute } from "wouter";
import { getBlogPost, getAllBlogPosts } from "@/data/blog-posts";
import { format } from "date-fns";
import NotFound from "./not-found";

export default function BlogPost() {
  const [, params] = useRoute<{ slug: string }>("/blog/:slug");
  const post = params ? getBlogPost(params.slug) : null;
  const allPosts = getAllBlogPosts();

  if (!post) {
    return <NotFound />;
  }

  // Get related posts (exclude current post)
  const relatedPosts = allPosts
    .filter(p => p.slug !== post.slug)
    .slice(0, 3);

  // Convert markdown-like content to React elements
  const formatContent = (content: string) => {
    const lines = content.split('\n');
    const elements: JSX.Element[] = [];
    let inList = false;
    let listItems: string[] = [];
    let keyCounter = 0;

    const processList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={keyCounter++} className="list-disc pl-6 mb-4 space-y-2">
            {listItems.map((item, idx) => (
              <li key={idx} className="text-muted-foreground leading-relaxed">
                {formatInlineMarkdown(item)}
              </li>
            ))}
          </ul>
        );
        listItems = [];
      }
      inList = false;
    };

    const formatInlineMarkdown = (text: string): (string | JSX.Element)[] => {
      const parts: (string | JSX.Element)[] = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;
      let key = 0;

      while ((match = boldRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }
        parts.push(<strong key={key++} className="text-foreground font-semibold">{match[1]}</strong>);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }
      return parts.length > 0 ? parts : [text];
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      // Headers
      if (trimmed.startsWith('# ')) {
        processList();
        elements.push(<h1 key={keyCounter++} className="text-3xl font-bold mt-8 mb-4 text-foreground">{trimmed.substring(2)}</h1>);
        return;
      }
      if (trimmed.startsWith('## ')) {
        processList();
        elements.push(<h2 key={keyCounter++} className="text-2xl font-semibold mt-6 mb-3 text-foreground">{trimmed.substring(3)}</h2>);
        return;
      }
      if (trimmed.startsWith('### ')) {
        processList();
        elements.push(<h3 key={keyCounter++} className="text-xl font-semibold mt-4 mb-2 text-foreground">{trimmed.substring(4)}</h3>);
        return;
      }

      // Lists
      if (trimmed.startsWith('- ')) {
        if (!inList) {
          processList();
          inList = true;
        }
        listItems.push(trimmed.substring(2));
        return;
      }

      // Process any existing list before regular content
      if (inList && trimmed !== '') {
        processList();
      }

      // Empty lines
      if (trimmed === '') {
        if (!inList) {
          elements.push(<br key={keyCounter++} />);
        }
        return;
      }

      // Regular paragraphs
      elements.push(
        <p key={keyCounter++} className="mb-4 text-muted-foreground leading-relaxed">
          {formatInlineMarkdown(trimmed)}
        </p>
      );
    });

    // Process any remaining list
    processList();

    return elements;
  };

  return (
    <div className="flex-1 bg-gradient-to-br from-background via-background to-muted/30">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/blog">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4 mb-4">
              <Badge variant="secondary">{post.category}</Badge>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {post.readTime} min read
              </div>
            </div>
            <CardTitle className="text-3xl mb-4">{post.title}</CardTitle>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <User className="h-4 w-4" />
                <span>{post.author}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span>{format(new Date(post.publishedDate), "MMMM d, yyyy")}</span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {formatContent(post.content)}
            </div>

            {relatedPosts.length > 0 && (
              <div className="mt-12 pt-8 border-t">
                <h3 className="text-xl font-semibold mb-4">Related Articles</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {relatedPosts.map((relatedPost) => (
                    <Link key={relatedPost.slug} href={`/blog/${relatedPost.slug}`}>
                      <Card className="h-full hover:shadow-md transition-shadow cursor-pointer group">
                        <CardHeader>
                          <Badge variant="outline" className="text-xs w-fit mb-2">
                            {relatedPost.category}
                          </Badge>
                          <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-2">
                            {relatedPost.title}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {relatedPost.excerpt}
                          </p>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

