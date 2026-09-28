import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RidgeLine - AI Scheduling & Dispatch Assistant',
  description: 'AI-powered scheduling and dispatch assistant for solo tradespeople. Runs booking conversations over SMS, auto-confirms jobs, parses natural-language reschedules, and converts missed calls into revenue.',
  openGraph: {
    title: 'RidgeLine - AI Scheduling & Dispatch Assistant',
    description: 'AI-powered scheduling and dispatch assistant for solo tradespeople. Runs booking conversations over SMS, auto-confirms jobs, parses natural-language reschedules, and converts missed calls into revenue.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-neutral-50 text-neutral-900 antialiased selection:bg-neutral-900 selection:text-white font-sans">
        {children}
      </body>
    </html>
  );
}
