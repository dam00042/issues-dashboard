"use client";

import { Toast } from "@heroui/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Toast.Provider maxVisibleToasts={3} placement="bottom end" />
      {children}
    </ThemeProvider>
  );
}
