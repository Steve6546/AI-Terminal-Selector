"use client";

import { useRef, useCallback, useEffect } from "react";

const BOTTOM_THRESHOLD = 80;

export function useStickyScroll(deps: unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStuckRef = useRef(true);
  const userScrolledRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isStuckRef.current = distanceFromBottom < BOTTOM_THRESHOLD;
    if (distanceFromBottom > BOTTOM_THRESHOLD) {
      userScrolledRef.current = true;
    } else {
      userScrolledRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isStuckRef.current) {
      const el = scrollRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return { scrollRef, scrollToBottom, isAtBottom: () => isStuckRef.current };
}
