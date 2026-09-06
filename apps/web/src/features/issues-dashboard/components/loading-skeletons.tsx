"use client";

import { Skeleton } from "@heroui/react";
import { memo, type PropsWithChildren } from "react";

export const PersistentDashboardSection = memo(
  function PersistentDashboardSection({
    active,
    children,
  }: PropsWithChildren<{ active: boolean }>) {
    return (
      <div
        aria-hidden={!active}
        className={active ? "h-full min-h-0" : "hidden"}
      >
        {children}
      </div>
    );
  },
  (previous, next) => !next.active && previous.active === next.active,
);

function CardSkeleton() {
  return (
    <div className="rounded-[0.9rem] border border-[rgb(var(--app-border))]/45 p-3">
      <Skeleton className="h-2.5 w-24 rounded-full" />
      <Skeleton className="mt-2 h-4 w-4/5 rounded-full" />
      <Skeleton className="mt-2 h-2.5 w-28 rounded-full" />
    </div>
  );
}

export function DashboardSectionSkeleton() {
  return (
    <div
      aria-label="Cargando sección"
      role="status"
      className="grid h-full min-h-0 gap-3 md:grid-cols-2"
    >
      {[0, 1].map((column) => (
        <section
          key={column}
          className="min-h-0 overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96"
        >
          <div className="flex items-center justify-between border-b border-[rgb(var(--app-border))]/55 px-3.5 py-3">
            <Skeleton className="h-4 w-36 rounded-full" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <div className="space-y-2 p-2.5">
            {[0, 1, 2, 3].map((card) => (
              <CardSkeleton key={card} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function LinkedPullRequestsSkeleton() {
  return (
    <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-3">
      <Skeleton className="h-3 w-40 rounded-full" />
      <Skeleton className="mt-3 h-9 w-full rounded-[0.75rem]" />
    </div>
  );
}

export function NotesEditorSkeleton() {
  return (
    <div
      aria-label="Cargando detalle de la issue"
      role="status"
      className="min-h-0 flex-1 space-y-4 px-3 py-3"
    >
      {[0, 1].map((block) => (
        <div key={block}>
          <Skeleton className="h-3 w-28 rounded-full" />
          <Skeleton className="mt-2 h-20 w-full rounded-[0.9rem]" />
        </div>
      ))}
    </div>
  );
}
