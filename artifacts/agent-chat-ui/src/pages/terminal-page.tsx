import { Sidebar } from "@/components/layout/sidebar";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { useLocation } from "wouter";

export default function TerminalPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-border/60 bg-card/30 shrink-0">
          <h1 className="text-xl font-semibold text-foreground">Terminal</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Interactive bash shell connected to the server environment.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <TerminalPanel onClose={() => setLocation("/")} />
        </div>
      </main>
    </div>
  );
}
