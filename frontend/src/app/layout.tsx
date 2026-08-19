import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

// Runs before first paint so the theme never flashes. Writes "light"
// explicitly, not just "dark": leaving it unset lets tokens.css's
// :root:not([data-theme='light']) block match, so a user on a dark OS who
// picks light in-app still gets dark.
const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","dark")}})()`;

export const metadata: Metadata = {
  metadataBase: new URL("https://watchwithmi.tn07.dev"),
  title: "WatchWithMi - Watch Together",
  description:
    "Watch videos together in perfect sync with friends. Create rooms, chat, and enjoy synchronized video streaming.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "WatchWithMi - Watch Together",
    description: "Create a room, add a video, and watch it together in sync.",
    url: "/",
    siteName: "WatchWithMi",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "WatchWithMi - Watch Together",
    description: "Create a room, add a video, and watch it together in sync.",
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Font classes on <html>, not <body>: globals.css reads --font-dm-sans at
    // :root, so on <body> they land below the lookup and fall back to system.
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning={true}
    >
      <head>
        <link rel="stylesheet" href="https://tn07.dev/design/tokens.css" />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM summary" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased" suppressHydrationWarning={true}>
        <ErrorBoundary>{children}</ErrorBoundary>
        <script src="https://tn07.dev/ring.js" defer />
      </body>
    </html>
  );
}
