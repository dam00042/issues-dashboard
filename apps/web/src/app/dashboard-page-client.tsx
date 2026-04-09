"use client";

import { Spinner } from "@heroui/react";
import { useEffect, useState } from "react";

import { DashboardApp } from "@/features/issues-dashboard/dashboard-app";

function LoadingShell() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="inline-flex items-center gap-3 rounded-full border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/92 px-4 py-3 text-sm text-[rgb(var(--app-muted))]">
        <Spinner size="sm" />
        Cargando GitHub Dashboard...
      </div>
    </main>
  );
}

export function DashboardPageClient() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <LoadingShell />;
  }

  return <DashboardApp />;
}
