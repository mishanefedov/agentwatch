import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { Settings as SettingsIcon, DollarSign, AlertTriangle, Bell, Save, FileText } from "lucide-react";
import clsx from "clsx";

export function SettingsShell() {
  return (
    <div className="h-full flex">
      <aside className="w-60 border-r border-bg-border bg-bg-surface px-3 py-4">
        <div className="flex items-center gap-2 mb-4 px-2">
          <SettingsIcon className="w-4 h-4 text-accent" />
          <h2 className="font-bold">settings</h2>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          <SettingsNav to="/settings/budgets" icon={<DollarSign className="w-4 h-4" />}>Budgets</SettingsNav>
          <SettingsNav to="/settings/anomaly" icon={<AlertTriangle className="w-4 h-4" />}>Anomaly thresholds</SettingsNav>
          <SettingsNav to="/settings/triggers" icon={<Bell className="w-4 h-4" />}>Triggers</SettingsNav>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function SettingsNav({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-2 px-3 py-2 rounded-md transition",
          isActive ? "bg-accent/20 text-accent" : "text-fg-dim hover:bg-bg-elev hover:text-fg",
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Generic JSON editor used by all three settings panels. Full validation
//  happens server-side; we just re-parse on save and show errors inline.
// ─────────────────────────────────────────────────────────────────────

function JsonEditor({ kind, label, description }: { kind: "budgets" | "anomaly" | "triggers"; label: string; description: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config", kind], queryFn: () => api.config(kind) });
  const [text, setText] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) setText(JSON.stringify(q.data.value, null, 2));
  }, [q.data]);

  const mut = useMutation({
    mutationFn: (value: unknown) => api.saveConfig(kind, value),
    onSuccess: () => {
      setFlash("saved");
      setTimeout(() => setFlash(null), 1500);
      qc.invalidateQueries({ queryKey: ["config", kind] });
    },
    onError: (err: Error) => {
      setSaveError(err.message);
    },
  });

  const onSave = () => {
    setSaveError(null);
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      mut.mutate(parsed);
    } catch (e: any) {
      setParseError(String(e.message ?? e));
    }
  };

  const onReset = () => {
    if (!q.data) return;
    setText(JSON.stringify(q.data.defaults, null, 2));
    setParseError(null);
    setSaveError(null);
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="text-lg font-bold">{label}</h1>
        {q.data?.path && <span className="text-xs text-fg-muted mono">{q.data.path}</span>}
      </div>
      <p className="text-sm text-fg-dim mb-4">{description}</p>

      <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-bg-elev border-b border-bg-border">
          <div className="flex items-center gap-2 text-xs text-fg-dim">
            <FileText className="w-3.5 h-3.5" />
            JSON
          </div>
          <div className="flex items-center gap-2">
            {flash && <span className="text-xs text-ok">✓ {flash}</span>}
            <button onClick={onReset} className="text-xs px-2 py-1 rounded-md border border-bg-border text-fg-dim hover:bg-bg">
              reset to defaults
            </button>
            <button
              onClick={onSave}
              disabled={mut.isPending}
              className="text-xs px-3 py-1 rounded-md bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-1 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> save
            </button>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="w-full p-3 mono text-sm bg-bg outline-none min-h-[300px] focus:ring-1 focus:ring-accent/50"
        />
      </div>

      {parseError && <div className="mt-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">invalid JSON: {parseError}</div>}
      {saveError && <div className="mt-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">save failed: {saveError}</div>}
    </div>
  );
}

export function BudgetsSettings() {
  return (
    <JsonEditor
      kind="budgets"
      label="Budgets"
      description="Cost caps. perSessionUsd fires a notification when any one session exceeds it; perDayUsd fires when aggregate daily cost breaches. Set to null to disable a cap."
    />
  );
}

export function AnomalySettings() {
  return (
    <JsonEditor
      kind="anomaly"
      label="Anomaly thresholds"
      description="zScore = MAD z-score cutoff for cost/tokens/duration outliers (default 3.5). loopWindow = how many recent events to scan for stuck-loop patterns. loopMinRepeats = same-tool repeats before flagging. minSamples = minimum history before scoring kicks in."
    />
  );
}

export function TriggersSettings() {
  return (
    <JsonEditor
      kind="triggers"
      label="Triggers"
      description="Custom desktop notifications. Each rule: { match?: regex, pathMatch?: regex, type?: EventType, thresholdUsd?: number, title: string, body: string }. The first rule whose condition fires notifies."
    />
  );
}
