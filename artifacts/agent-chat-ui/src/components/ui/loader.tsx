import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Loader({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
    xl: "w-12 h-12"
  };

  return (
    <Loader2 
      className={cn(
        "animate-spin text-primary", 
        sizeClasses[size],
        className
      )} 
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <Loader size="xl" className="text-indigo-500" />
        <p className="text-muted-foreground font-mono text-sm tracking-widest uppercase animate-pulse">
          INITIALIZING...
        </p>
      </div>
    </div>
  );
}
