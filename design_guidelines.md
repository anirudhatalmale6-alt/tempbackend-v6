# Design Guidelines: Temporary Email Web Application

## Design Approach
**Hybrid Approach**: Material Design system for email functionality combined with modern, clean aesthetics inspired by Superhuman and Temp-Mail services. Focus on clarity, speed perception, and ease of use.

## Typography System
- **Primary Font**: Inter (Google Fonts) for UI elements and body text
- **Monospace Font**: JetBrains Mono for email addresses and technical content
- **Hierarchy**:
  - H1: text-4xl md:text-5xl font-bold (Hero headline)
  - H2: text-2xl md:text-3xl font-semibold (Section headers)
  - H3: text-lg font-semibold (Email subjects, card titles)
  - Body: text-base (Email content, descriptions)
  - Small: text-sm (Timestamps, metadata)
  - Tiny: text-xs (Labels, badges)

## Layout System
**Spacing Primitives**: Use Tailwind units of 2, 4, 6, and 8 consistently
- Component padding: p-4 to p-6
- Section spacing: py-12 to py-20
- Element gaps: gap-4 to gap-6
- Container max-width: max-w-7xl for main content, max-w-4xl for email viewer

## Core Layout Structure

### Hero Section (Above Fold)
- **Height**: 60vh on desktop, auto on mobile
- **Layout**: Centered content with asymmetric split
  - Left: Headline + description + generated email display with copy button
  - Right: Simple illustration showing email flow concept
- **Email Display Component**: Large monospace text box with gradient border, copy button integrated
- **CTA**: "Generate New Email" button prominently placed
- **Background**: Subtle gradient mesh or abstract geometric pattern

### Email Inbox Section
**Two-Column Layout** (desktop):
- **Left Sidebar** (30% width): Email list with compact cards
  - Each card: Sender name, subject (truncated), timestamp, unread indicator
  - Hover state: subtle elevation
  - Active state: highlighted background
- **Right Panel** (70% width): Email detail view
  - Header: Full subject, sender details, timestamp
  - Body: Email content with HTML rendering
  - Actions: Delete button, refresh indicator

**Mobile**: Stack vertically with list view first, detail view slides in

### Features Section
**Three-Column Grid** (desktop):
1. **Instant Generation**: Icon + title + brief description
2. **No Registration**: Icon + title + brief description  
3. **Auto-Refresh**: Icon + title + brief description

### How It Works Section
**Horizontal Timeline** (desktop) / **Vertical Steps** (mobile):
- 3-4 steps with numbers, icons, and descriptions
- Connecting lines between steps

## Component Library

### Primary Components
1. **Email Address Display Card**
   - Large text area with monospace font
   - Integrated copy button (icon + text)
   - Success feedback animation on copy
   - Subtle border with rounded corners (rounded-lg)

2. **Email List Item Card**
   - Compact height (h-20 to h-24)
   - Grid layout: sender/subject/time
   - Unread badge indicator
   - Truncate long text with ellipsis

3. **Email Viewer Panel**
   - Full-width container with padding (p-6 to p-8)
   - Clear header/body separation
   - Monospace for technical details (email addresses)
   - Sans-serif for content

4. **Action Buttons**
   - Primary: Large, rounded (rounded-lg), solid fill
   - Secondary: Outlined, same rounding
   - Icon buttons: Square with icon-only, subtle background

5. **Status Indicators**
   - Unread badge: Small circular dot
   - Loading spinner: Animated icon
   - Empty state: Centered illustration + message

### Navigation
- **Header**: Sticky top bar with logo left, optional links right
- **Footer**: Simple centered links and branding

## Icons
**Heroicons** via CDN for all interface icons:
- Copy icon for clipboard action
- Refresh icon for inbox reload
- Trash icon for delete
- Envelope icons for email states
- Clock icon for timestamps

## Images

### Hero Section Image
**Placement**: Right side of hero split layout (40% width on desktop)
**Description**: Modern, minimalist illustration showing email envelope transforming into a shield or temporary document, using line art style with subtle gradients. Should convey privacy and temporariness.
**Alternative**: Abstract geometric composition with envelope motifs

### Feature Icons
Use icon library (Heroicons), no custom images needed

### Empty State Illustration
**Placement**: Center of email viewer when no email selected
**Description**: Simple line art illustration of empty inbox or waiting state, friendly and minimal

## Animations
**Use Sparingly**:
- Copy button: Quick scale pulse on successful copy
- Email arrival: Subtle fade-in for new items in list
- Loading states: Gentle pulse on refresh icon
- Page transitions: None (instant for speed perception)

## Responsive Breakpoints
- **Mobile** (default): Single column, stack all elements
- **Tablet** (md: 768px): Introduce two-column layouts
- **Desktop** (lg: 1024px): Full multi-column experience

## Accessibility
- All interactive elements have focus states with visible outlines
- Email content supports keyboard navigation
- Sufficient contrast for all text (will be addressed in color phase)
- ARIA labels for icon-only buttons
- Semantic HTML structure throughout

## Key UX Patterns
1. **Email Generation**: One-click action, immediate feedback
2. **Auto-Refresh**: Visual indicator when checking for new emails (every 10-15s)
3. **Copy Feedback**: Toast notification or button state change
4. **Empty States**: Friendly messaging when inbox is empty
5. **Loading States**: Skeleton screens for email list, spinner for content
6. **Error Handling**: Clear inline messages for IMAP connection issues

## Production Quality Standards
- Crisp typography with proper line-height (1.5 for body, 1.2 for headings)
- Consistent spacing rhythm throughout
- Polished micro-interactions on all interactive elements
- Professional empty and loading states
- Mobile-optimized touch targets (minimum 44px)