import type { Metadata } from "next";
import "@/index.css";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Agent Tool Chat",
  description: "MCP-powered AI agent chat interface",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
