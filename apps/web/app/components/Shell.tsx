"use client";

import { useState } from "react";
import { LuMenu } from "react-icons/lu";
import { LeftRail } from "./LeftRail";

/**
 * App shell. Desktop (lg+): static left rail + content in a 2-col grid.
 * Mobile: the rail becomes an off-canvas slide-over toggled by a hamburger.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const [railOpen, setRailOpen] = useState(false);

  return (
    <div className="h-screen lg:grid lg:grid-cols-[272px_1fr]">
      {/* Left rail — fixed slide-over on mobile, static column on lg+ */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:translate-x-0 ${
          railOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <LeftRail onNavigate={() => setRailOpen(false)} />
      </div>

      {railOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setRailOpen(false)}
        />
      )}

      <div className="flex h-screen min-w-0 flex-col">
        {/* Mobile top bar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2 lg:hidden">
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Open menu"
            className="btn btn-ghost btn-sm btn-square"
          >
            <LuMenu className="h-5 w-5" />
          </button>
          <span className="font-display text-sm font-extrabold tracking-tight">Agent Engine</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
