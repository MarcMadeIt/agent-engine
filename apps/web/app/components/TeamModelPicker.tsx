"use client";

import type { ModelProvider, ModelSpec, RoleModelsConfig } from "@arzonic/agent-client";

/** A role ("stilling") that can be pinned to its own model — human label, hint, dot colour. */
export interface TeamRole {
  key: string;
  label: string;
  hint: string;
  /** Tailwind bg-* class for the role's colour dot (matches the create-view roster). */
  dot: string;
}

/** Per-role UI selection: which provider + model + temperature each "stilling" runs on. */
export type TeamSelection = Record<string, { provider: string; model: string; temperature?: string }>;

/**
 * The team "stillinger" — human job titles + the same colours the create-view
 * roster uses (Udvikler=builder, Kritiker=critic, Arkitekt=lead, Lead=human),
 * with distinct colours for the mission-only planning roles.
 */
export const TEAM_ROLES: TeamRole[] = [
  { key: "decompose", label: "Planlægger", hint: "mål → backlog", dot: "bg-analyst" },
  { key: "architect", label: "Arkitekt", hint: "designer trinene", dot: "bg-lead" },
  { key: "implementer", label: "Udvikler", hint: "skriver koden", dot: "bg-builder" },
  { key: "critic", label: "Kritiker", hint: "udfordrer arbejdet", dot: "bg-critic" },
  { key: "tester", label: "Tester", hint: "skriver testen", dot: "bg-success" },
  { key: "lead", label: "Lead", hint: "samler resultatet", dot: "bg-human" },
  { key: "replan", label: "Koordinator", hint: "beslutter næste skridt", dot: "bg-warning" },
];

/** Providers the picker offers. There is no inherit option — every role pins one. */
const PROVIDERS: { value: ModelProvider; label: string }[] = [
  { value: "mistral", label: "Mistral" },
  { value: "anthropic", label: "Claude" },
  { value: "google", label: "Gemini" },
];

/** Mistral is the default provider for a freshly-shown role (no inherit anymore). */
const DEFAULT_PROVIDER: ModelProvider = "mistral";

/** Default model per provider — the runtime fallback when no model is pinned (mirrors buildModel). */
const DEFAULT_MODELS: Record<ModelProvider, string> = {
  mistral: "mistral-large-latest",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.0-flash",
};

/** Selectable models per provider, most-capable first. The empty model = the provider default above. */
const MODELS_BY_PROVIDER: Record<ModelProvider, string[]> = {
  mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  google: ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
};

/** Collapse a selection into the wire shape, dropping "Standard" (inherit). */
export function selectionToRoleModels(sel: TeamSelection): RoleModelsConfig {
  const out: RoleModelsConfig = {};
  for (const [role, s] of Object.entries(sel)) {
    if (!s.provider) continue;
    const spec: ModelSpec = { provider: s.provider as ModelProvider };
    if (s.model.trim()) spec.model = s.model.trim();
    const t = s.temperature?.trim();
    if (t) {
      const n = Number(t);
      if (Number.isFinite(n)) spec.temperature = n;
    }
    out[role] = spec;
  }
  return out;
}

/** Build a UI selection from a stored config (for editing existing settings). */
export function roleModelsToSelection(cfg: RoleModelsConfig | undefined): TeamSelection {
  const out: TeamSelection = {};
  for (const [role, s] of Object.entries(cfg ?? {})) {
    const spec = s as ModelSpec;
    out[role] = {
      provider: spec.provider,
      model: spec.model ?? "",
      temperature: spec.temperature !== undefined ? String(spec.temperature) : "",
    };
  }
  return out;
}

/** Models that ignore temperature (steered via prompting) — the input is disabled for them. */
const ANTHROPIC_IGNORES_TEMPERATURE = ["claude-opus-4-7", "claude-opus-4-8", "claude-fable-5"];
function ignoresTemperature(provider: ModelProvider, model: string): boolean {
  return provider === "anthropic" && ANTHROPIC_IGNORES_TEMPERATURE.some((p) => model.startsWith(p));
}

/** How many roles are pinned (not "Standard"). */
export function teamCount(sel: TeamSelection): number {
  return Object.values(sel).filter((s) => s.provider).length;
}

/**
 * A compact per-role provider/model picker, reused by the mission composer (a
 * mission's own team) and settings (the global default team). `availableProviders`,
 * when given, disables providers whose API key isn't configured server-side.
 */
export function TeamModelPicker({
  roles,
  value,
  onChange,
  availableProviders,
}: {
  roles: TeamRole[];
  value: TeamSelection;
  onChange: (next: TeamSelection) => void;
  availableProviders?: ModelProvider[];
}) {
  return (
    <div className="space-y-2">
      {roles.map((role) => {
        const sel = value[role.key] ?? { provider: DEFAULT_PROVIDER, model: "" };
        const provider = (sel.provider || DEFAULT_PROVIDER) as ModelProvider;
        const models = MODELS_BY_PROVIDER[provider] ?? [];
        const tempIgnored = ignoresTemperature(provider, sel.model);
        return (
          <div
            key={role.key}
            className="flex items-center gap-3 rounded-field border border-line bg-elev/50 px-2.5 py-1.5 transition"
          >
            <span className="flex w-36 shrink-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${role.dot}`} />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-xs font-semibold text-fg">{role.label}</span>
                <span className="block truncate text-[10px] text-dim">{role.hint}</span>
              </span>
            </span>
            <select
              value={provider}
              onChange={(e) =>
                onChange({
                  ...value,
                  [role.key]: { provider: e.target.value, model: "", temperature: sel.temperature },
                })
              }
              className="select select-xs w-28 border-line bg-elev text-xs"
            >
              {PROVIDERS.map((p) => {
                const disabled = !!availableProviders && !availableProviders.includes(p.value);
                return (
                  <option key={p.value} value={p.value} disabled={disabled}>
                    {p.label}
                    {disabled ? " (ingen nøgle)" : ""}
                  </option>
                );
              })}
            </select>
            <select
              value={sel.model}
              onChange={(e) =>
                onChange({ ...value, [role.key]: { provider, model: e.target.value, temperature: sel.temperature } })
              }
              className="select select-xs flex-1 border-line bg-elev text-xs"
            >
              <option value="">{DEFAULT_MODELS[provider]}</option>
              {models
                .filter((m) => m !== DEFAULT_MODELS[provider])
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
            </select>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={tempIgnored ? "" : (sel.temperature ?? "")}
              disabled={tempIgnored}
              placeholder={tempIgnored ? "—" : "temp"}
              title={
                tempIgnored
                  ? "Denne Claude-model styres via prompting, ikke temperatur"
                  : "Temperatur 0–2 (0 = deterministisk). Tom = standard (0.2)."
              }
              onChange={(e) =>
                onChange({ ...value, [role.key]: { provider, model: sel.model, temperature: e.target.value } })
              }
              className="input input-xs w-16 border-line bg-elev text-xs disabled:opacity-40"
            />
          </div>
        );
      })}
    </div>
  );
}
