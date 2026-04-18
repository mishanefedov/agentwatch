import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";

export function PermissionsPage() {
  const q = useQuery({ queryKey: ["permissions"], queryFn: api.permissions });

  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  const p = q.data ?? {};

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Shield className="w-5 h-5 text-accent" />
        <h1 className="text-lg font-bold">permissions</h1>
      </div>
      <div className="p-5 space-y-5 max-w-5xl">
        <AgentPermissionCard label="Claude Code" perms={p.claude} />
        <AgentPermissionCard label="Codex" perms={p.codex} />
        <AgentPermissionCard label="Gemini" perms={p.gemini} />
        <AgentPermissionCard label="OpenClaw" perms={p.openclaw} />
      </div>
    </div>
  );
}

function AgentPermissionCard({ label, perms }: { label: string; perms: any }) {
  if (!perms) {
    return (
      <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-fg-muted" />
          <h2 className="font-bold">{label}</h2>
          <span className="text-xs text-fg-muted">not installed / no config</span>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-ok" />
        <h2 className="font-bold">{label}</h2>
      </div>
      <pre className="mono text-xs text-fg-dim overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(perms, null, 2)}
      </pre>
    </div>
  );
}
