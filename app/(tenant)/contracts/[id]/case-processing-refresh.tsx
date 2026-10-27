"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function CaseProcessingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
