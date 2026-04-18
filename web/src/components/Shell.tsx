import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Activity, Folder, Terminal, Settings, Search, BarChart3, Shield, Clock } from "lucide-react";
import clsx from "clsx";
import { useLiveEvents } from "../lib/store";

export function Shell() {
  useLiveEvents(); // subscribes to SSE on mount; store drives the Timeline
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
  });
  return (
    <div className="h-full flex flex-col bg-bg text-fg">
      <header className="flex items-center gap-6 px-5 py-3 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent" />
          <div className="font-bold">agentwatch</div>
          <div className="text-xs text-fg-dim">
            {health.data?.version ? `v${health.data.version}` : ""}
          </div>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <NavItem to="/" label="Timeline" icon={<Activity className="w-4 h-4" />} end />
          <NavItem to="/projects" label="Projects" icon={<Folder className="w-4 h-4" />} />
          <NavItem to="/agents" label="Agents" icon={<Terminal className="w-4 h-4" />} disabled />
          <NavItem to="/search" label="Search" icon={<Search className="w-4 h-4" />} disabled />
          <NavItem to="/trends" label="Trends" icon={<BarChart3 className="w-4 h-4" />} disabled />
          <NavItem to="/permissions" label="Permissions" icon={<Shield className="w-4 h-4" />} disabled />
          <NavItem to="/cron" label="Scheduled" icon={<Clock className="w-4 h-4" />} disabled />
          <NavItem to="/settings" label="Settings" icon={<Settings className="w-4 h-4" />} disabled />
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-fg-dim">
          <span className={clsx("w-2 h-2 rounded-full", health.isSuccess ? "bg-ok" : "bg-warn")} />
          <span>{health.isSuccess ? "connected" : "connecting…"}</span>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon,
  end,
  disabled,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-fg-muted cursor-not-allowed" title="coming in the next phase">
        {icon}
        {label}
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md transition",
          isActive ? "bg-accent/20 text-accent" : "text-fg-dim hover:bg-bg-elev hover:text-fg",
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
