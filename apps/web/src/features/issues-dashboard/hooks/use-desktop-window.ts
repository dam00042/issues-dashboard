"use client";

import { useEffect, useState } from "react";

import type { ThemeMode } from "@/types/desktop";

export function useDesktopWindow(theme: ThemeMode) {
  const [isDesktopClient, setIsDesktopClient] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.githubIssuesDesktop) {
      return;
    }

    setIsDesktopClient(true);
    const desktop = window.githubIssuesDesktop;

    void desktop.getWindowState?.().then((state) => {
      setIsMaximized(state.isMaximized);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.githubIssuesDesktop) {
      return;
    }

    void window.githubIssuesDesktop.setTitleBarTheme?.(theme);
  }, [theme]);

  const handleMinimize = () => {
    void window.githubIssuesDesktop?.minimizeWindow?.();
  };

  const handleToggleMaximize = () => {
    void window.githubIssuesDesktop?.toggleMaximizeWindow?.().then((state) => {
      setIsMaximized(state.isMaximized);
    });
  };

  const handleClose = () => {
    void window.githubIssuesDesktop?.closeWindow?.();
  };

  return {
    handleClose,
    handleMinimize,
    handleToggleMaximize,
    isDesktopClient,
    isMaximized,
  };
}
