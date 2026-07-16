"use client";

import { createContext, useContext, useEffect, useState } from "react";

const FeatureContext = createContext<Record<string, boolean>>({});

export function FeatureProvider({
  features: initial,
  children,
}: {
  features: Record<string, boolean>;
  children: React.ReactNode;
}) {
  const [features, setFeatures] = useState(initial);

  // Sync when server passes updated initial values (RSC re-render on navigation)
  useEffect(() => {
    setFeatures(initial);
  }, [initial]);

  // Re-fetch from API on mount so changes made by admin are visible without full reload
  useEffect(() => {
    fetch("/api/v1/features")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.features) setFeatures(data.features); })
      .catch(() => {});
  }, []);

  return (
    <FeatureContext.Provider value={features}>
      {children}
    </FeatureContext.Provider>
  );
}

export function useFeature(id: string): boolean {
  return useContext(FeatureContext)[id] ?? false;
}

export function useFeatures(): Record<string, boolean> {
  return useContext(FeatureContext);
}
