import { useState, useEffect, useRef, useCallback } from "react";

// ─── Helpers ───
async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    return data;
  } catch { return { zones: [], carriers: [] }; }
}

async function saveZones(zones) {
  try { await fetch("/api/zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(zones) }); } catch (e) { console.error(e); }
}

async function saveCarriers(carriers) {
  try { await fetch("/api/carriers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(carriers) }); } catch (e) { console.error(e); }
}

// ─── Client list helpers ───
async function loadClients() {
  try {
    const res = await fetch("/api/clients");
    return await res.json();
  } catch { return []; }
}
async function saveClients(clients) {
  try { await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clients) }); } catch (e) { console.error(e); }
}

// ─── History helpers ───
async function loadHistoryDates() {
  try {
    const res = await fetch("/api/history/dates");
    return await res.json();
  } catch { return []; }
}
async function loadHistoryDay(date) {
  try {
    const res = await fetch(`/api/history/${date}`);
    return await res.json();
  } catch { return []; }
}
async function saveHistoryEntry(date, entry) {
  try {
    await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, entry }),
    });
  } catch (e) { console.error(e); }
}
async function deleteHistoryEntry(date, entryId) {
  try {
    await fetch(`/api/history/${date}/${entryId}`, { method: "DELETE" });
  } catch (e) { console.error(e); }
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseZPL(text) {
  const shipments = [];
  // Extract every individual ^XA...^XZ label
  const allLabels = text.match(/\^XA[\s\S]*?\^XZ/g);
  if (!allLabels) return shipments;

  const cleanText = (s) => s ? s.replace(/_C3_[A-F0-9]{2}/g, "").replace(/_2E/g, ".").replace(/_2D/g, "-").replace(/_20/g, " ").trim() : s;

  for (const lab of allLabels) {
    // Skip page break commands
    if (lab.trim() === "^XA^MCY^XZ") continue;

    // Check if it has SKU (real label vs garbage)
    const skuM = lab.match(/SKU: ([^\^]+)/);
    if (!skuM) continue;

    const qtyM = lab.match(/FO10,130.*?FD(\d+)/);
    const sku = skuM[1].trim();
    const qty = qtyM ? parseInt(qtyM[1]) : 1;

    const isFlex = lab.includes("Flex");

    let cp = null, envioNum = null, destinatario = null, localidad = null, tipoEnvio = null;
    let direccion = null, barrio = null, referencia = null, fecha = null;

    if (isFlex) {
      const cpM = lab.match(/FB890,1,0,C.*?FD(\d{4})/);
      const envM = lab.match(/Envio: (\d+)/);
      const destM = lab.match(/Destinatario: ([^\^]+)/);
      const locM = lab.match(/FO0,660.*?FD([^\^]+)/);
      const tipoM = lab.match(/FO0,770.*?FD([^\^]+)/);
      const dirM = lab.match(/Direccion: ([^\^]+)/);
      const barrioM = lab.match(/Barrio: ([^\^]+)/);
      const refM = lab.match(/Referencia: ([^\^]+)/);
      const fechaM = lab.match(/FO400,195\^A0N,48,48\^FB400,1,0,C\^FD([^\^]+)/);

      if (cpM) cp = cpM[1];
      if (envM) envioNum = envM[1];
      if (destM) destinatario = cleanText(destM[1]);
      if (locM) localidad = cleanText(locM[1]);
      if (tipoM) tipoEnvio = tipoM[1].trim();
      if (dirM) direccion = cleanText(dirM[1]);
      if (barrioM) barrio = cleanText(barrioM[1]);
      if (refM) referencia = cleanText(refM[1]);
      if (fechaM) fecha = fechaM[1].trim();
    } else {
      // COLECTA: CP from text pattern, deduplicated
      const cpMatches = lab.match(/CP[:\s]+(\d{4})/g);
      if (cpMatches) {
        const cps = cpMatches.map((m) => m.match(/(\d{4})/)[1]);
        cp = [...new Set(cps)][0];
      }
    }

    shipments.push({
      type: isFlex ? "FLEX" : "COLECTA",
      cp,
      envio: envioNum,
      destinatario,
      localidad,
      tipoEnvio,
      direccion,
      barrio,
      referencia,
      fecha,
      items: [{ sku, qty }],
      rawLabels: [lab],
      uid: Math.random().toString(36).slice(2),
    });
  }
  return shipments;
}

function groupSkus(items) {
  const map = {};
  for (const it of items) {
    map[it.sku] = (map[it.sku] || 0) + it.qty;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ─── Components ───

// ─── Design tokens (industrial theme) ───
const T = {
  paper: "#f5f2ea",
  surface: "#ffffff",
  surfaceAlt: "#faf8f3",
  border: "#c9c3b2",
  borderStrong: "#a8a08a",
  ink: "#1a1a1a",
  inkDim: "#4a4a4a",
  inkMute: "#7a7a6e",
  accent: "#ea580c",
  accentDark: "#c2410c",
  accentLight: "#fef3e7",
  success: "#15803d",
  successLight: "#e8f3ec",
  warning: "#b45309",
  warningLight: "#fdf3e3",
  danger: "#b91c1c",
  dangerLight: "#fbe9e9",
  info: "#1e3a5f",
  infoLight: "#e7eef5",
  purple: "#6b21a8",
  purpleLight: "#f1e7f7",
};

function Badge({ children, color = "blue" }) {
  const colors = {
    blue: { bg: T.infoLight, text: T.info, border: "#c2cfde" },
    green: { bg: T.successLight, text: T.success, border: "#b5d4bf" },
    orange: { bg: T.warningLight, text: T.warning, border: "#e3c893" },
    red: { bg: T.dangerLight, text: T.danger, border: "#e0b5b5" },
    purple: { bg: T.purpleLight, text: T.purple, border: "#d5b9df" },
    gray: { bg: "#ecebe4", text: T.inkDim, border: T.border },
  };
  const c = colors[color] || colors.blue;
  return (
    <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", letterSpacing: "0.02em", textTransform: "uppercase" }}>
      {children}
    </span>
  );
}

function Card({ children, title, icon, accent, style }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", ...style }}>
      {title && (
        <h3 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 700, color: T.ink, display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.04em", paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
          {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, style, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3, padding: "7px 10px", color: T.ink, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit", ...style }}
      onFocus={(e) => e.currentTarget.style.borderColor = T.accent}
      onBlur={(e) => e.currentTarget.style.borderColor = T.border}
    />
  );
}

function Btn({ children, onClick, variant = "primary", disabled, style, small }) {
  const variants = {
    primary: { bg: T.accent, hover: T.accentDark, text: "#fff", border: T.accent },
    secondary: { bg: T.surface, hover: "#f0ece2", text: T.ink, border: T.borderStrong },
    danger: { bg: T.danger, hover: "#991b1b", text: "#fff", border: T.danger },
    ghost: { bg: "transparent", hover: "#ecebe4", text: T.inkDim, border: "transparent" },
  };
  const v = variants[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#e5e1d5" : v.bg,
        color: disabled ? T.inkMute : v.text,
        border: `1px solid ${disabled ? T.border : v.border}`,
        borderRadius: 3, padding: small ? "4px 10px" : "7px 14px",
        fontSize: small ? 11 : 12, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .12s", display: "inline-flex", alignItems: "center", gap: 5,
        textTransform: "uppercase", letterSpacing: "0.04em",
        fontFamily: "inherit", ...style
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = v.hover; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = v.bg; }}
    >
      {children}
    </button>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 0, background: "#ffffff", borderRadius: 4, border: `1px solid #c9c3b2`, marginBottom: 16, overflow: "hidden" }}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1, padding: "10px 14px", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 700, transition: "all .12s",
            background: active === t.id ? "#ea580c" : "transparent",
            color: active === t.id ? "#fff" : "#4a4a4a",
            borderLeft: i === 0 ? "none" : `1px solid #c9c3b2`,
            textTransform: "uppercase", letterSpacing: "0.04em",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { if (active !== t.id) e.currentTarget.style.background = "#f0ece2"; }}
          onMouseLeave={(e) => { if (active !== t.id) e.currentTarget.style.background = "transparent"; }}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Toast system ───
// Global helper: call toast("mensaje", "success" | "error" | "info")
function toast(message, type = "success") {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { message, type, id: Date.now() + Math.random() } }));
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail;
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 3500);
    };
    window.addEventListener("app-toast", handler);
    return () => window.removeEventListener("app-toast", handler);
  }, []);

  const colors = {
    success: { bg: "#15803d", border: "#15803d" },
    error: { bg: "#b91c1c", border: "#b91c1c" },
    info: { bg: "#1e3a5f", border: "#1e3a5f" },
  };

  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => {
        const c = colors[t.type] || colors.success;
        return (
          <div
            key={t.id}
            style={{
              background: c.bg, color: "#fff", padding: "10px 16px", borderRadius: 3,
              border: `1px solid ${c.border}`, minWidth: 220, maxWidth: 360,
              fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              animation: "toastSlideIn .2s ease-out",
            }}
          >
            {t.message}
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Collapsible CPs ───
function CollapsibleCPs({ cps, color = "blue", previewCount = 3 }) {
  const [expanded, setExpanded] = useState(false);
  const showToggle = cps.length > previewCount;
  const visible = expanded ? cps : cps.slice(0, previewCount);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {visible.map((cp) => <Badge key={cp} color={color}>{cp}</Badge>)}
      {showToggle && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          style={{ background: "none", border: "1px solid #c9c3b2", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#555555", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          {expanded ? "▲ ocultar" : `+${cps.length - previewCount} más`}
        </button>
      )}
    </div>
  );
}

// ─── Zone Card ───
function ZoneCard({ zone, zones, onRemove, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [newCps, setNewCps] = useState("");
  const [error, setError] = useState(null);

  const addCps = () => {
    if (!newCps.trim()) return;
    const cpList = newCps.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);

    // Check duplicates within same zone
    const existing = new Set(zone.cps);
    const alreadyInZone = cpList.filter((cp) => existing.has(cp));

    // Check duplicates in other zones
    const otherCps = {};
    for (const z of zones) {
      if (z.id === zone.id) continue;
      for (const cp of z.cps) otherCps[cp] = z.name;
    }
    const inOtherZone = cpList.filter((cp) => otherCps[cp]);

    if (inOtherZone.length > 0) {
      setError(`CP${inOtherZone.length > 1 ? "s" : ""} ${inOtherZone.join(", ")} ya está${inOtherZone.length > 1 ? "n" : ""} en ${[...new Set(inOtherZone.map((cp) => otherCps[cp]))].join(", ")}`);
      return;
    }

    const uniqueNew = cpList.filter((cp) => !existing.has(cp));
    if (uniqueNew.length === 0) {
      setError("Esos CPs ya están en esta zona");
      return;
    }

    onUpdate({ ...zone, cps: [...zone.cps, ...uniqueNew] });
    setNewCps("");
    setAdding(false);
    setError(null);
  };

  return (
    <div style={{ padding: "10px 14px", background: "#faf8f3", borderRadius: 3, marginBottom: 6, border: "1px solid #c9c3b2" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#1a1a1a", fontWeight: 600, fontSize: 14 }}>{zone.name}</span>
          <Badge color="gray">{zone.cps.length} CPs</Badge>
          <CollapsibleCPs cps={zone.cps} color="blue" />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn variant="secondary" small onClick={() => { setAdding(!adding); setError(null); }}>
            {adding ? "Cancelar" : "+ CP"}
          </Btn>
          <Btn variant="ghost" small onClick={onRemove}>✕</Btn>
        </div>
      </div>
      {adding && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Input
              value={newCps}
              onChange={setNewCps}
              placeholder="Nuevos CPs: 1500, 1501, 1502"
              style={{ flex: "1 1 200px", fontSize: 12, padding: "5px 10px" }}
            />
            <Btn small onClick={addCps}>Agregar</Btn>
          </div>
          {error && (
            <p style={{ color: "#b91c1c", fontSize: 12, margin: "6px 0 0 0" }}>⚠ {error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Zones Panel ───
function ZonesPanel({ zones, setZones }) {
  const [name, setName] = useState("");
  const [cps, setCps] = useState("");
  const [conflicts, setConflicts] = useState(null); // { newCps, duplicates: [{cp, zoneName, zoneId}] }
  const [dupeSelections, setDupeSelections] = useState({}); // cp -> "new" | zoneId

  // Check for existing duplicates on mount
  const [showExistingDupes, setShowExistingDupes] = useState(false);
  const [existingDupes, setExistingDupes] = useState([]);

  useEffect(() => {
    // Detect duplicates across existing zones
    const cpMap = {};
    const dupes = [];
    for (const z of zones) {
      for (const cp of z.cps) {
        if (cpMap[cp]) {
          dupes.push({ cp, zones: [cpMap[cp], z.name] });
        } else {
          cpMap[cp] = z.name;
        }
      }
    }
    // Deduplicate
    const seen = new Set();
    const uniqueDupes = dupes.filter((d) => {
      if (seen.has(d.cp)) return false;
      seen.add(d.cp);
      return true;
    });
    setExistingDupes(uniqueDupes);
    if (uniqueDupes.length > 0) setShowExistingDupes(true);
  }, []);

  const resolveExistingDupe = (cp, keepZoneName) => {
    setZones((prev) => prev.map((z) => {
      if (z.name === keepZoneName) return z;
      return { ...z, cps: z.cps.filter((c) => c !== cp) };
    }));
    setExistingDupes((prev) => prev.filter((d) => d.cp !== cp));
  };

  const add = () => {
    if (!name.trim() || !cps.trim()) return;
    const cpList = cps.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);

    // Check for duplicates against existing zones
    const allExistingCps = {};
    for (const z of zones) {
      for (const cp of z.cps) {
        allExistingCps[cp] = { zoneName: z.name, zoneId: z.id };
      }
    }

    const duplicates = cpList.filter((cp) => allExistingCps[cp]).map((cp) => ({
      cp,
      zoneName: allExistingCps[cp].zoneName,
      zoneId: allExistingCps[cp].zoneId,
    }));

    if (duplicates.length > 0) {
      // Show conflict resolution
      setConflicts({ name: name.trim(), cpList, duplicates });
      const defaultSelections = {};
      duplicates.forEach((d) => { defaultSelections[d.cp] = "new"; });
      setDupeSelections(defaultSelections);
    } else {
      // No conflicts, add directly
      setZones((prev) => [...prev, { id: Date.now(), name: name.trim(), cps: cpList }]);
      setName(""); setCps("");
    }
  };

  const resolveConflicts = () => {
    if (!conflicts) return;
    const cpsToRemoveFromOldZones = {};
    const cpsForNewZone = [];

    for (const cp of conflicts.cpList) {
      const dupe = conflicts.duplicates.find((d) => d.cp === cp);
      if (!dupe) {
        cpsForNewZone.push(cp);
      } else if (dupeSelections[cp] === "new") {
        cpsForNewZone.push(cp);
        if (!cpsToRemoveFromOldZones[dupe.zoneId]) cpsToRemoveFromOldZones[dupe.zoneId] = [];
        cpsToRemoveFromOldZones[dupe.zoneId].push(cp);
      }
      // If selection is the old zone id, don't add to new zone
    }

    setZones((prev) => {
      const updated = prev.map((z) => {
        if (cpsToRemoveFromOldZones[z.id]) {
          return { ...z, cps: z.cps.filter((c) => !cpsToRemoveFromOldZones[z.id].includes(c)) };
        }
        return z;
      });
      return [...updated, { id: Date.now(), name: conflicts.name, cps: cpsForNewZone }];
    });

    setConflicts(null);
    setDupeSelections({});
    setName(""); setCps("");
  };

  const remove = (id) => setZones((prev) => prev.filter((z) => z.id !== id));

  return (
    <Card title="Zonas de envío" icon="🗺️" accent="#60a5fa">
      <p style={{ color: "#555555", fontSize: 13, margin: "0 0 16px 0" }}>
        Agrupaciones de CPs para el resumen. Cada CP solo puede pertenecer a una zona.
      </p>

      {/* Existing duplicates warning */}
      {showExistingDupes && existingDupes.length > 0 && (
        <div style={{ padding: 14, background: "#fdf3e3", border: "1px solid #e3c893", borderRadius: 3, marginBottom: 12 }}>
          <p style={{ color: "#b45309", fontSize: 13, fontWeight: 700, margin: "0 0 10px 0" }}>
            ⚠ Se encontraron CPs repetidos entre zonas. Elegí dónde querés que quede cada uno:
          </p>
          {existingDupes.map((d) => (
            <div key={d.cp} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <Badge color="orange">{d.cp}</Badge>
              <span style={{ color: "#555555", fontSize: 12 }}>está en:</span>
              {d.zones.map((zName) => (
                <Btn key={zName} small variant="secondary" onClick={() => resolveExistingDupe(d.cp, zName)}>
                  Dejar en {zName}
                </Btn>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Input value={name} onChange={setName} placeholder="Nombre de zona" style={{ flex: "1 1 150px" }} />
        <Input value={cps} onChange={setCps} placeholder="CPs separados por coma: 1000, 1001, 1036" style={{ flex: "2 1 250px" }} />
        <Btn onClick={add} disabled={!name.trim() || !cps.trim()}>+ Agregar</Btn>
      </div>

      {/* Conflict resolution for new zone */}
      {conflicts && (
        <div style={{ padding: 14, background: "#e7eef5", border: "1px solid #c2cfde", borderRadius: 3, marginBottom: 12 }}>
          <p style={{ color: "#1e3a5f", fontSize: 13, fontWeight: 700, margin: "0 0 10px 0" }}>
            Algunos CPs de "{conflicts.name}" ya existen en otras zonas. ¿Dónde los querés dejar?
          </p>
          {conflicts.duplicates.map((d) => (
            <div key={d.cp} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <Badge color="blue">{d.cp}</Badge>
              <span style={{ color: "#555555", fontSize: 12 }}>existe en {d.zoneName}:</span>
              <button
                onClick={() => setDupeSelections((prev) => ({ ...prev, [d.cp]: "new" }))}
                style={{
                  padding: "3px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: dupeSelections[d.cp] === "new" ? "#ea580c" : "#ffffff",
                  color: dupeSelections[d.cp] === "new" ? "#fff" : "#555555",
                  border: `1px solid ${dupeSelections[d.cp] === "new" ? "#ea580c" : "#c9c3b2"}`,
                }}
              >
                Mover a {conflicts.name}
              </button>
              <button
                onClick={() => setDupeSelections((prev) => ({ ...prev, [d.cp]: d.zoneId }))}
                style={{
                  padding: "3px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: dupeSelections[d.cp] !== "new" ? "#ea580c" : "#ffffff",
                  color: dupeSelections[d.cp] !== "new" ? "#fff" : "#555555",
                  border: `1px solid ${dupeSelections[d.cp] !== "new" ? "#ea580c" : "#c9c3b2"}`,
                }}
              >
                Dejar en {d.zoneName}
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <Btn small onClick={resolveConflicts}>Confirmar</Btn>
            <Btn small variant="ghost" onClick={() => setConflicts(null)}>Cancelar</Btn>
          </div>
        </div>
      )}

      {zones.length === 0 && <p style={{ color: "#8a8a7e", fontSize: 13, textAlign: "center", padding: 20 }}>No hay zonas configuradas</p>}
      {zones.map((z) => (
        <ZoneCard key={z.id} zone={z} zones={zones} onRemove={() => remove(z.id)} onUpdate={(updated) => setZones((prev) => prev.map((zz) => zz.id === updated.id ? updated : zz))} />
      ))}
    </Card>
  );
}

// ─── Carriers Panel ───
function CarrierCard({ carrier, onRemove, onUpdate, zones }) {
  const [editingPrioCps, setEditingPrioCps] = useState(false);
  const [prioCpsInput, setPrioCpsInput] = useState((carrier.priorityCps || []).join(", "));
  const [editingZoneLimits, setEditingZoneLimits] = useState(false);
  const [zoneLimitsInput, setZoneLimitsInput] = useState({});
  const [editingTotalLimit, setEditingTotalLimit] = useState(false);
  const [totalLimitInput, setTotalLimitInput] = useState(carrier.limit ? String(carrier.limit) : "");

  const togglePriority = () => {
    onUpdate({ ...carrier, priority: (carrier.priority || "COMERCIAL") === "COMERCIAL" ? "RESIDENCIAL" : "COMERCIAL" });
  };

  const savePrioCps = () => {
    const cpList = prioCpsInput.trim() ? prioCpsInput.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean) : [];
    onUpdate({ ...carrier, priorityCps: cpList });
    setEditingPrioCps(false);
  };

  const clearPrioCps = () => {
    onUpdate({ ...carrier, priorityCps: [] });
    setPrioCpsInput("");
    setEditingPrioCps(false);
  };

  const startEditZoneLimits = () => {
    const current = carrier.zoneLimits || {};
    const inputs = {};
    zones.forEach((z) => { inputs[z.id] = current[z.id] !== undefined ? String(current[z.id]) : ""; });
    setZoneLimitsInput(inputs);
    setEditingZoneLimits(true);
  };

  const saveZoneLimits = () => {
    const limits = {};
    Object.entries(zoneLimitsInput).forEach(([id, val]) => {
      const num = parseInt(val);
      if (!isNaN(num) && num > 0) limits[id] = num;
    });
    onUpdate({ ...carrier, zoneLimits: limits });
    setEditingZoneLimits(false);
  };

  const prio = carrier.priority || "COMERCIAL";
  const hasPrioCps = carrier.priorityCps && carrier.priorityCps.length > 0;
  const zoneLimits = carrier.zoneLimits || {};
  const hasZoneLimits = Object.keys(zoneLimits).length > 0;

  return (
    <div style={{ padding: "12px 14px", background: "#faf8f3", borderRadius: 3, marginBottom: 6, border: "1px solid #c9c3b2" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "#1a1a1a", fontWeight: 600, fontSize: 14 }}>{carrier.name}</span>
          {editingTotalLimit ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Input
                value={totalLimitInput}
                onChange={setTotalLimitInput}
                placeholder="Sin tope"
                type="number"
                style={{ width: 80, fontSize: 12, padding: "3px 8px" }}
              />
              <Btn small onClick={() => {
                const num = parseInt(totalLimitInput);
                onUpdate({ ...carrier, limit: (!isNaN(num) && num > 0) ? num : null });
                setEditingTotalLimit(false);
              }}>OK</Btn>
              <Btn small variant="ghost" onClick={() => setEditingTotalLimit(false)}>✕</Btn>
            </div>
          ) : (
            <button
              onClick={() => { setTotalLimitInput(carrier.limit ? String(carrier.limit) : ""); setEditingTotalLimit(true); }}
              style={{ background: "#fdf3e3", color: "#b45309", border: "1px solid #e3c893", borderRadius: 3, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              {carrier.limit ? `Tope total: ${carrier.limit}` : "Tope total: ∞"}
            </button>
          )}
          <button
            onClick={togglePriority}
            style={{
              background: prio === "COMERCIAL" ? "#e8f3ec" : "#e7eef5",
              color: prio === "COMERCIAL" ? "#15803d" : "#1e3a5f",
              border: `1px solid ${prio === "COMERCIAL" ? "#b5d4bf" : "#c2cfde"}`,
              borderRadius: 3, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}
          >
            Prioriza: {prio}
          </button>
          <Badge color="gray">{carrier.cps.length} CPs</Badge>
          <CollapsibleCPs cps={carrier.cps} color="green" />
        </div>
        <Btn variant="ghost" small onClick={onRemove}>✕</Btn>
      </div>

      {/* CPs prioritarios - editable */}
      <div style={{ marginTop: 8, padding: "8px 10px", background: "#ffffff", borderRadius: 3, border: "1px solid #c9c3b2" }}>
        {editingPrioCps ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#6b21a8", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>CPs prioritarios:</span>
            <Input
              value={prioCpsInput}
              onChange={setPrioCpsInput}
              placeholder="1400, 1401, 1402..."
              style={{ flex: "1 1 200px", fontSize: 12, padding: "5px 10px" }}
            />
            <Btn small onClick={savePrioCps}>Guardar</Btn>
            <Btn small variant="ghost" onClick={() => setEditingPrioCps(false)}>Cancelar</Btn>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 }}>
              <span style={{ color: "#6b21a8", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>CPs prioritarios:</span>
              {hasPrioCps ? (
                <CollapsibleCPs cps={carrier.priorityCps} color="purple" previewCount={5} />
              ) : (
                <span style={{ color: "#8a8a7e", fontSize: 12 }}>Sin configurar</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <Btn small variant="secondary" onClick={() => { setPrioCpsInput((carrier.priorityCps || []).join(", ")); setEditingPrioCps(true); }}>
                {hasPrioCps ? "Editar" : "+ Agregar"}
              </Btn>
              {hasPrioCps && <Btn small variant="ghost" onClick={clearPrioCps}>Limpiar</Btn>}
            </div>
          </div>
        )}
      </div>

      {/* Topes por zona - editable */}
      {zones.length > 0 && (
        <div style={{ marginTop: 6, padding: "8px 10px", background: "#ffffff", borderRadius: 3, border: "1px solid #c9c3b2" }}>
          {editingZoneLimits ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: "#b45309", fontSize: 12, fontWeight: 600 }}>Topes por zona:</span>
              {zones.map((z) => (
                <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#2a2a2a", fontSize: 12, minWidth: 80 }}>{z.name}:</span>
                  <Input
                    value={zoneLimitsInput[z.id] || ""}
                    onChange={(val) => setZoneLimitsInput((prev) => ({ ...prev, [z.id]: val }))}
                    placeholder="Sin tope"
                    type="number"
                    style={{ width: 100, fontSize: 12, padding: "4px 8px" }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                <Btn small onClick={saveZoneLimits}>Guardar</Btn>
                <Btn small variant="ghost" onClick={() => setEditingZoneLimits(false)}>Cancelar</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 }}>
                <span style={{ color: "#b45309", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>Topes por zona:</span>
                {hasZoneLimits ? (
                  zones.filter((z) => zoneLimits[z.id]).map((z) => (
                    <Badge key={z.id} color="orange">{z.name}: {zoneLimits[z.id]}</Badge>
                  ))
                ) : (
                  <span style={{ color: "#8a8a7e", fontSize: 12 }}>Sin configurar</span>
                )}
              </div>
              <Btn small variant="secondary" onClick={startEditZoneLimits}>
                {hasZoneLimits ? "Editar" : "+ Configurar"}
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CarriersPanel({ carriers, setCarriers, zones }) {
  const [name, setName] = useState("");
  const [cps, setCps] = useState("");
  const [limit, setLimit] = useState("");
  const [priority, setPriority] = useState("COMERCIAL");

  const add = () => {
    if (!name.trim() || !cps.trim()) return;
    const cpList = cps.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
    setCarriers((prev) => [...prev, {
      id: Date.now(),
      name: name.trim(),
      cps: cpList,
      limit: limit ? parseInt(limit) : null,
      priorityCps: [],
      priority,
    }]);
    setName(""); setCps(""); setLimit(""); setPriority("COMERCIAL");
  };
  const remove = (id) => setCarriers((prev) => prev.filter((c) => c.id !== id));
  const update = (updated) => setCarriers((prev) => prev.map((c) => c.id === updated.id ? updated : c));

  return (
    <Card title="Transportistas" icon="🚛" accent="#4ade80">
      <p style={{ color: "#555555", fontSize: 13, margin: "0 0 16px 0" }}>
        Cada transportista tiene CPs asignados, un tope opcional y prioridad por tipo de envío. Los CPs prioritarios se configuran en cada tarjeta.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Input value={name} onChange={setName} placeholder="Nombre" style={{ flex: "1 1 120px" }} />
        <Input value={cps} onChange={setCps} placeholder="CPs asignados: 1000, 1001, 1036" style={{ flex: "2 1 220px" }} />
        <Input value={limit} onChange={setLimit} placeholder="Tope (vacío=sin tope)" type="number" style={{ flex: "0 1 130px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
          <span style={{ color: "#555555", fontSize: 12 }}>Priorizar:</span>
          <button
            onClick={() => setPriority(priority === "COMERCIAL" ? "RESIDENCIAL" : "COMERCIAL")}
            style={{
              background: priority === "COMERCIAL" ? "#e8f3ec" : "#e7eef5",
              color: priority === "COMERCIAL" ? "#15803d" : "#1e3a5f",
              border: `1px solid ${priority === "COMERCIAL" ? "#b5d4bf" : "#c2cfde"}`,
              borderRadius: 3, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            {priority}
          </button>
        </div>
        <Btn onClick={add} variant="primary" disabled={!name.trim() || !cps.trim()}>+ Agregar</Btn>
      </div>
      {carriers.length === 0 && <p style={{ color: "#8a8a7e", fontSize: 13, textAlign: "center", padding: 20 }}>No hay transportistas configurados</p>}
      {carriers.map((c) => (
        <CarrierCard key={c.id} carrier={c} onRemove={() => remove(c.id)} onUpdate={update} zones={zones} />
      ))}
    </Card>
  );
}

// ─── File Upload ───
function FileUpload({ onParsed, clients, setClients }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [clientName, setClientName] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const fileRef = useRef();

  const addFiles = (newFiles) => {
    const validFiles = Array.from(newFiles).filter((f) => {
      if (f.name.endsWith(".zip")) return false;
      return f.name.endsWith(".txt");
    });
    if (Array.from(newFiles).some((f) => f.name.endsWith(".zip"))) {
      setError("Los archivos ZIP no están soportados. Descomprimí primero y cargá los .txt");
    }
    if (validFiles.length === 0 && !Array.from(newFiles).some((f) => f.name.endsWith(".zip"))) {
      setError("Solo se aceptan archivos .txt");
      return;
    }
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const unique = validFiles.filter((f) => !existingNames.has(f.name));
      return [...prev, ...unique];
    });
    if (validFiles.length > 0) setError(null);
  };

  const removeFile = (name) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const processAll = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const allShipments = [];
      for (const file of files) {
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error("Error leyendo " + file.name));
          reader.readAsText(file, "utf-8");
        });
        const shipments = parseZPL(text);
        allShipments.push(...shipments);
      }
      if (allShipments.length === 0) {
        setError("No se encontraron etiquetas en ningún archivo.");
        setLoading(false);
        return;
      }

      // Save new client name if provided and not in list
      const cleanName = clientName.trim();
      if (cleanName && !clients.includes(cleanName)) {
        const newClients = [...clients, cleanName].sort((a, b) => a.localeCompare(b));
        setClients(newClients);
        saveClients(newClients);
      }

      onParsed(allShipments, cleanName || "Sin asignar");
      setFiles([]);
      setClientName("");
    } catch (e) {
      setError("Error al procesar: " + e.message);
    }
    setLoading(false);
  };

  // Filter client suggestions based on input
  const filteredClients = clientName.trim()
    ? clients.filter((c) => c.toLowerCase().includes(clientName.toLowerCase()) && c.toLowerCase() !== clientName.toLowerCase())
    : clients;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); addFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragging ? "#ea580c" : "#a8a08a"}`, borderRadius: 4, padding: 30,
          textAlign: "center", transition: "all .2s",
          background: dragging ? "#fef3e7" : "#ffffff",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
        <p style={{ color: "#1a1a1a", fontSize: 14, fontWeight: 700, margin: "0 0 4px 0", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Arrastrá tus archivos TXT acá
        </p>
        <p style={{ color: "#555555", fontSize: 12, margin: "0 0 14px 0" }}>
          Podés cargar varios archivos a la vez
        </p>
        <label style={{
          display: "inline-block", background: "#ea580c", color: "#fff", padding: "9px 20px",
          borderRadius: 3, fontSize: 12, fontWeight: 700, cursor: "pointer",
          textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          Seleccionar archivos .txt
          <input
            ref={fileRef}
            type="file"
            accept=".txt"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />
        </label>
      </div>

      {/* File queue */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#1a1a1a", fontSize: 14, fontWeight: 600 }}>
              {files.length} archivo{files.length !== 1 ? "s" : ""} cargado{files.length !== 1 ? "s" : ""}
            </span>
            <Btn small variant="ghost" onClick={() => setFiles([])}>Limpiar todo</Btn>
          </div>
          {files.map((f) => (
            <div key={f.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#555555", fontSize: 14 }}>📄</span>
                <span style={{ color: "#2a2a2a", fontSize: 13 }}>{f.name}</span>
                <span style={{ color: "#8a8a7e", fontSize: 11 }}>({(f.size / 1024).toFixed(1)} KB)</span>
              </div>
              <Btn variant="ghost" small onClick={() => removeFile(f.name)}>✕</Btn>
            </div>
          ))}

          {/* Client selector */}
          <div style={{ padding: "10px 12px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", marginTop: 4 }}>
            <label style={{ display: "block", color: "#555555", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              CLIENTE (opcional)
            </label>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Nombre del cliente, ej: Drink Suma, Yopi..."
                style={{ background: "#faf8f3", border: "1px solid #c9c3b2", borderRadius: 3, padding: "8px 12px", color: "#1a1a1a", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" }}
              />
              {showSuggestions && filteredClients.length > 0 && (
                <>
                  <div onClick={() => setShowSuggestions(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
                  <div style={{
                    position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 11,
                    background: "#ffffff", border: "1px solid #c9c3b2", borderRadius: 3,
                    maxHeight: 180, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                  }}>
                    {filteredClients.map((c) => (
                      <button
                        key={c}
                        onClick={() => { setClientName(c); setShowSuggestions(false); }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", color: "#2a2a2a", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #e5e1d5" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f0ece2"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {clients.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                <span style={{ color: "#8a8a7e", fontSize: 11 }}>Recientes:</span>
                {clients.slice(0, 8).map((c) => (
                  <button
                    key={c}
                    onClick={() => setClientName(c)}
                    style={{ background: clientName === c ? "#e8f3ec" : "#ffffff", border: `1px solid ${clientName === c ? "#b5d4bf" : "#c9c3b2"}`, color: clientName === c ? "#15803d" : "#555555", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            {!clientName.trim() && (
              <p style={{ color: "#b45309", fontSize: 11, margin: "6px 0 0 0" }}>
                ⚠ Sin cliente → se guardará como "Sin asignar"
              </p>
            )}
          </div>

          <Btn
            onClick={processAll}
            disabled={loading}
            style={{ width: "100%", padding: "14px 20px", fontSize: 15, justifyContent: "center", borderRadius: 4, marginTop: 4 }}
          >
            {loading ? "Procesando..." : "🚀 COMENZAR"}
          </Btn>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", background: "#fbe9e9", border: "1px solid #e0b5b5", borderRadius: 3, color: "#b91c1c", fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

// ─── Envio Chip (movable) ───
function EnvioChip({ shipment, currentLocation, carriers, isOverride, onMove, onClearOverride }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = `CP ${shipment.cp} → ${shipment.destinatario || shipment.envio || "Colecta"}`;
  const otherCarriers = carriers.filter((c) => c.id !== currentLocation);

  return (
    <div style={{
      fontSize: 11, color: "#555555", background: isOverride ? "#f1e7f7" : "#ffffff",
      padding: "4px 8px", borderRadius: 4, border: `1px solid ${isOverride ? "#d5b9df" : "#c9c3b2"}`,
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        {isOverride && <span style={{ color: "#6b21a8", fontSize: 10 }} title="Movido manualmente">✎</span>}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      {shipment.envio && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", position: "relative" }}>
          {isOverride && (
            <button
              onClick={onClearOverride}
              style={{ background: "none", border: "1px solid #d5b9df", borderRadius: 3, padding: "1px 6px", fontSize: 10, color: "#6b21a8", cursor: "pointer" }}
              title="Deshacer movimiento manual"
            >
              ↺
            </button>
          )}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ background: "none", border: "1px solid #c9c3b2", borderRadius: 3, padding: "1px 6px", fontSize: 10, color: "#555555", cursor: "pointer" }}
          >
            Mover ▾
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 11,
                background: "#ffffff", border: "1px solid #c9c3b2", borderRadius: 3, padding: 4,
                minWidth: 140, boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}>
                {otherCarriers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { onMove(c.id); setMenuOpen(false); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 8px", background: "none", border: "none", color: "#2a2a2a", fontSize: 11, cursor: "pointer", borderRadius: 3 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f0ece2"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                  >
                    → {c.name}
                  </button>
                ))}
                {currentLocation !== "EXTRA" && (
                  <button
                    onClick={() => { onMove("EXTRA"); setMenuOpen(false); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 8px", background: "none", border: "none", color: "#b91c1c", fontSize: 11, cursor: "pointer", borderRadius: 3 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f0ece2"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                  >
                    → EXTRA
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Unassigned CPs ───
function UnassignedCPs({ noZoneShipments, zones, setZones }) {
  const [assigningCp, setAssigningCp] = useState(null);

  // Group shipments by CP
  const byCP = {};
  for (const s of noZoneShipments) {
    if (!byCP[s.cp]) byCP[s.cp] = [];
    byCP[s.cp].push(s);
  }
  const cpList = Object.keys(byCP).sort();

  const assignToZone = (cp, zoneId) => {
    setZones((prev) => prev.map((z) => z.id === zoneId ? { ...z, cps: [...z.cps, cp] } : z));
    setAssigningCp(null);
  };

  return (
    <div style={{ padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #e0b5b5" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#b91c1c", fontWeight: 600, fontSize: 14 }}>Sin zona asignada</span>
        <Badge color="red">{noZoneShipments.length} envío{noZoneShipments.length !== 1 ? "s" : ""}</Badge>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {cpList.map((cp) => (
          <div key={cp} style={{ padding: "6px 10px", background: "#ffffff", borderRadius: 3, border: "1px solid #c9c3b2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge color="red">{cp}</Badge>
                <span style={{ color: "#555555", fontSize: 12 }}>{byCP[cp].length} envío{byCP[cp].length !== 1 ? "s" : ""}</span>
                {byCP[cp][0].localidad && (
                  <span style={{ color: "#8a8a7e", fontSize: 11 }}>({byCP[cp][0].localidad})</span>
                )}
              </div>
              {assigningCp === cp ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ color: "#555555", fontSize: 11 }}>Asignar a:</span>
                  {zones.map((z) => (
                    <Btn key={z.id} small variant="secondary" onClick={() => assignToZone(cp, z.id)}>
                      {z.name}
                    </Btn>
                  ))}
                  <Btn small variant="ghost" onClick={() => setAssigningCp(null)}>✕</Btn>
                </div>
              ) : (
                zones.length > 0 && (
                  <Btn small variant="secondary" onClick={() => setAssigningCp(cp)}>
                    + Asignar a zona
                  </Btn>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Results Dashboard ───
function ResultsDashboard({ shipments, zones, carriers, setZones, currentClient }) {
  const flex = shipments.filter((s) => s.type === "FLEX");
  const colecta = shipments.filter((s) => s.type === "COLECTA");

  // Manual overrides: envio -> carrierId | "EXTRA"
  const [manualOverrides, setManualOverrides] = useState({});
  const [savedToHistory, setSavedToHistory] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);

  // Reset overrides and saved state when shipments change (new file loaded)
  useEffect(() => {
    setManualOverrides({});
    setSavedToHistory(false);
  }, [shipments]);

  const moveEnvio = (envio, target) => {
    setManualOverrides((prev) => ({ ...prev, [envio]: target }));
  };
  const clearOverride = (envio) => {
    setManualOverrides((prev) => {
      const next = { ...prev };
      delete next[envio];
      return next;
    });
  };

  const allItems = shipments.flatMap((s) => s.items);

  // Zone breakdown for flex
  const zoneBreakdown = zones.map((z) => {
    const matched = flex.filter((s) => s.cp && z.cps.includes(s.cp));
    return { zone: z, count: matched.length, shipments: matched };
  });
  const zonedCPs = new Set(zones.flatMap((z) => z.cps));
  const noZone = flex.filter((s) => s.cp && !zonedCPs.has(s.cp));

  // Carrier assignment with priorities + zone limits
  const carrierAssignments = [];
  const assigned = new Set();

  // Helper: find which zone a CP belongs to
  const getZoneForCP = (cp) => zones.find((z) => z.cps.includes(cp));

  // Group flex labels by envio number so all labels of same envio stay together
  const flexByEnvio = {};
  for (const s of flex) {
    const key = s.envio || `_noenvio_${Math.random()}`;
    if (!flexByEnvio[key]) flexByEnvio[key] = [];
    flexByEnvio[key].push(s);
  }

  for (const c of carriers) {
    // Get envios (groups) matching this carrier's CPs
    const matchingGroups = Object.entries(flexByEnvio)
      .filter(([key, group]) => !assigned.has(key) && group[0].cp && c.cps.includes(group[0].cp))
      .map(([key, group]) => ({ key, group }));

    // Sort by priority (using first label's attributes)
    const priorityType = c.priority || "COMERCIAL";
    const prioCps = (c.priorityCps || []).map(Number);

    matchingGroups.sort((a, b) => {
      const sa = a.group[0], sb = b.group[0];
      const aTypeScore = (sa.tipoEnvio === priorityType) ? 0 : 1;
      const bTypeScore = (sb.tipoEnvio === priorityType) ? 0 : 1;
      if (aTypeScore !== bTypeScore) return aTypeScore - bTypeScore;

      if (prioCps.length > 0) {
        const aCp = Number(sa.cp);
        const bCp = Number(sb.cp);
        const aExact = prioCps.includes(aCp) ? 0 : 1;
        const bExact = prioCps.includes(bCp) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        const aMinDist = Math.min(...prioCps.map((p) => Math.abs(aCp - p)));
        const bMinDist = Math.min(...prioCps.map((p) => Math.abs(bCp - p)));
        if (aMinDist !== bMinDist) return aMinDist - bMinDist;
      }

      return 0;
    });

    // Apply zone limits + total limit. Count envios (groups), not individual labels.
    const zoneLimits = c.zoneLimits || {};
    const zoneCounts = {};
    const taken = [];
    const overflow = [];
    let takenCount = 0;

    for (const { key, group } of matchingGroups) {
      const firstLabel = group[0];
      // Check total limit (1 envio = 1 group, regardless of label count)
      if (c.limit && takenCount >= c.limit) {
        overflow.push(...group);
        assigned.add(key); // Mark as assigned so no other carrier takes it
        continue;
      }
      // Check zone limit
      const zone = getZoneForCP(firstLabel.cp);
      if (zone && zoneLimits[zone.id]) {
        const count = zoneCounts[zone.id] || 0;
        if (count >= zoneLimits[zone.id]) {
          overflow.push(...group);
          assigned.add(key);
          continue;
        }
        zoneCounts[zone.id] = count + 1;
      }
      taken.push(...group);
      takenCount += 1;
      assigned.add(key);
    }

    carrierAssignments.push({ carrier: c, shipments: taken, overflow });
  }
  // Everything not in a carrier's shipments goes to extra (includes overflow from carriers)
  const takenSet = new Set();
  for (const ca of carrierAssignments) {
    for (const s of ca.shipments) takenSet.add(s);
  }
  let extra = flex.filter((s) => !takenSet.has(s));

  // Apply manual overrides (moves ALL labels of same envio together)
  if (Object.keys(manualOverrides).length > 0) {
    // Collect all flex labels by envio (keeping all, not just last)
    const labelsByEnvio = {};
    for (const s of flex) {
      if (s.envio) {
        if (!labelsByEnvio[s.envio]) labelsByEnvio[s.envio] = [];
        labelsByEnvio[s.envio].push(s);
      }
    }

    for (const [envio, target] of Object.entries(manualOverrides)) {
      const ships = labelsByEnvio[envio];
      if (!ships || ships.length === 0) continue;

      // Remove ALL labels of this envio from current locations
      for (const ca of carrierAssignments) {
        ca.shipments = ca.shipments.filter((s) => s.envio !== envio);
      }
      extra = extra.filter((s) => s.envio !== envio);

      // Add all labels to target
      if (target === "EXTRA") {
        extra.push(...ships);
      } else {
        const targetCa = carrierAssignments.find((ca) => String(ca.carrier.id) === String(target));
        if (targetCa) targetCa.shipments.push(...ships);
        else extra.push(...ships);
      }
    }
  }

  // Generate downloadable TXT files
  const generateTXT = (selectedShipments) => {
    // For each selected shipment, find ALL flex labels with that envio number
    const envioNums = new Set(selectedShipments.map((s) => s.envio).filter(Boolean));
    const allLabels = flex.filter((s) => envioNums.has(s.envio)).flatMap((s) => s.rawLabels || []);
    return allLabels.join("\n^XA^MCY^XZ\n") + (allLabels.length ? "\n^XA^MCY^XZ\n" : "");
  };

  const download = (filename, content) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast(`✓ ${filename} descargado`);
  };

  const handleGenerateAll = () => {
    let count = 0;
    for (const ca of carrierAssignments) {
      if (ca.shipments.length > 0) {
        const txt = generateTXT(ca.shipments);
        const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${ca.carrier.name.replace(/\s+/g, "_")}.txt`; a.click();
        URL.revokeObjectURL(url);
        count++;
      }
    }
    if (extra.length > 0) {
      const txt = generateTXT(extra);
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "EXTRA_sin_transportista.txt"; a.click();
      URL.revokeObjectURL(url);
      count++;
    }
    toast(`✓ ${count} archivo${count !== 1 ? "s" : ""} TXT descargado${count !== 1 ? "s" : ""}`);
  };

  // Format date for printable reports
  const today = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });

  // Generate printable summary for a single carrier (opens print dialog)
  const printCarrierSummary = (carrier, shipments) => {
    // Group by zone for cleaner presentation
    const byZone = {};
    const noZoneList = [];
    for (const s of shipments) {
      const zone = zones.find((z) => z.cps.includes(s.cp));
      if (zone) {
        if (!byZone[zone.name]) byZone[zone.name] = [];
        byZone[zone.name].push(s);
      } else {
        noZoneList.push(s);
      }
    }

    const allSkus = shipments.flatMap((s) => s.items);
    const skuTotals = {};
    for (const it of allSkus) skuTotals[it.sku] = (skuTotals[it.sku] || 0) + it.qty;

    const zonesHtml = Object.entries(byZone).map(([zoneName, list]) => `
      <h3 class="zone-header">${zoneName} <span class="zone-count">(${list.length} envío${list.length !== 1 ? "s" : ""})</span></h3>
      <table>
        <thead><tr><th>#</th><th>CP</th><th>Destinatario</th><th>Dirección</th><th>Localidad</th><th>Items</th><th>Tipo</th></tr></thead>
        <tbody>
          ${list.map((s, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${s.cp || "—"}</strong></td>
              <td>${s.destinatario || "—"}</td>
              <td>${s.direccion || "—"}</td>
              <td>${s.localidad || "—"}</td>
              <td>${s.items.map((it) => `${it.sku} ×${it.qty}`).join(", ")}</td>
              <td>${s.tipoEnvio || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `).join("");

    const noZoneHtml = noZoneList.length > 0 ? `
      <h3 class="zone-header zone-warning">Sin zona asignada <span class="zone-count">(${noZoneList.length})</span></h3>
      <table>
        <thead><tr><th>#</th><th>CP</th><th>Destinatario</th><th>Dirección</th><th>Localidad</th><th>Items</th><th>Tipo</th></tr></thead>
        <tbody>
          ${noZoneList.map((s, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${s.cp || "—"}</strong></td>
              <td>${s.destinatario || "—"}</td>
              <td>${s.direccion || "—"}</td>
              <td>${s.localidad || "—"}</td>
              <td>${s.items.map((it) => `${it.sku} ×${it.qty}`).join(", ")}</td>
              <td>${s.tipoEnvio || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : "";

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Resumen ${carrier.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; color: #222; margin: 0; padding: 24px; }
  h1 { margin: 0 0 4px 0; font-size: 24px; color: #1a1a1a; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 20px; }
  .meta-row { display: flex; gap: 20px; padding: 14px 18px; background: #f5f5f5; border-radius: 8px; margin-bottom: 20px; }
  .meta-item { flex: 1; }
  .meta-label { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
  .meta-value { font-size: 18px; font-weight: 700; color: #1a1a1a; }
  .zone-header { font-size: 15px; margin: 22px 0 8px 0; padding-bottom: 6px; border-bottom: 2px solid #1a1a1a; }
  .zone-warning { border-bottom-color: #c23; color: #c23; }
  .zone-count { font-weight: normal; color: #888; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
  th { text-align: left; padding: 8px 10px; background: #f0f0f0; border-bottom: 1px solid #ccc; font-weight: 700; }
  td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) td { background: #fafafa; }
  .sku-summary { margin-top: 24px; padding: 14px 18px; background: #f5f5f5; border-radius: 8px; }
  .sku-summary h3 { margin: 0 0 10px 0; font-size: 14px; }
  .sku-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
  .sku-item { padding: 6px 10px; background: white; border-radius: 4px; font-size: 12px; display: flex; justify-content: space-between; }
  .sku-name { font-family: monospace; }
  .sku-qty { font-weight: 700; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 12px; } .no-print { display: none; } }
  .no-print { position: fixed; top: 10px; right: 10px; }
  .no-print button { background: #1a1a1a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
</style></head>
<body>
<div class="no-print"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<h1>${carrier.name}</h1>
<div class="subtitle">Hoja de ruta para transportista</div>

<div class="meta-row">
  <div class="meta-item"><div class="meta-label">Fecha</div><div class="meta-value">${today}</div></div>
  <div class="meta-item"><div class="meta-label">Total envíos</div><div class="meta-value">${shipments.length}</div></div>
  <div class="meta-item"><div class="meta-label">Total unidades</div><div class="meta-value">${allSkus.reduce((n, it) => n + it.qty, 0)}</div></div>
</div>

${zonesHtml}
${noZoneHtml}

<div class="sku-summary">
  <h3>Resumen de productos</h3>
  <div class="sku-grid">
    ${Object.entries(skuTotals).sort((a, b) => b[1] - a[1]).map(([sku, qty]) => `
      <div class="sku-item"><span class="sku-name">${sku}</span><span class="sku-qty">×${qty}</span></div>
    `).join("")}
  </div>
</div>

<div class="footer">Generado automáticamente el ${today}</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  // Generate general printable report (all results)
  const printGeneralReport = () => {
    const allFlexItems = flex.flatMap((s) => s.items);
    const allColectaItems = colecta.flatMap((s) => s.items);
    const skuTotals = {};
    for (const it of [...allFlexItems, ...allColectaItems]) skuTotals[it.sku] = (skuTotals[it.sku] || 0) + it.qty;

    const zonesHtml = zoneBreakdown.map((zb) => `
      <tr><td>${zb.zone.name}</td><td style="text-align: right; font-weight: 700;">${zb.count}</td></tr>
    `).join("");

    const carriersHtml = carrierAssignments.map((ca) => `
      <tr>
        <td>${ca.carrier.name}</td>
        <td style="text-align: right;">${ca.shipments.length}</td>
        <td style="text-align: right; color: ${ca.overflow.length > 0 ? "#c23" : "#999"};">${ca.overflow.length || "—"}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Resumen general</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; color: #222; margin: 0; padding: 24px; }
  h1 { margin: 0 0 4px 0; font-size: 24px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 20px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 24px; }
  .stat-box { padding: 16px; background: #f5f5f5; border-radius: 8px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 800; color: #1a1a1a; }
  .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
  h2 { font-size: 16px; margin: 24px 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #1a1a1a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; background: #f0f0f0; border-bottom: 1px solid #ccc; }
  td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  .sku-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
  .sku-item { padding: 6px 10px; background: #f5f5f5; border-radius: 4px; font-size: 12px; display: flex; justify-content: space-between; }
  .sku-name { font-family: monospace; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 12px; } .no-print { display: none; } }
  .no-print { position: fixed; top: 10px; right: 10px; }
  .no-print button { background: #1a1a1a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
</style></head>
<body>
<div class="no-print"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<h1>Resumen general de envíos</h1>
<div class="subtitle">${today}</div>

<div class="stats-grid">
  <div class="stat-box"><div class="stat-value">${flex.length}</div><div class="stat-label">Envíos FLEX</div></div>
  <div class="stat-box"><div class="stat-value">${colecta.length}</div><div class="stat-label">Órdenes COLECTA</div></div>
  <div class="stat-box"><div class="stat-value">${[...allFlexItems, ...allColectaItems].reduce((n, it) => n + it.qty, 0)}</div><div class="stat-label">Unidades totales</div></div>
</div>

${zones.length > 0 ? `
<h2>Envíos FLEX por zona</h2>
<table>
  <thead><tr><th>Zona</th><th style="text-align: right;">Envíos</th></tr></thead>
  <tbody>
    ${zonesHtml}
    ${noZone.length > 0 ? `<tr><td style="color: #c23;">Sin zona asignada</td><td style="text-align: right; font-weight: 700; color: #c23;">${noZone.length}</td></tr>` : ""}
  </tbody>
</table>
` : ""}

${carriers.length > 0 ? `
<h2>Asignación por transportista</h2>
<table>
  <thead><tr><th>Transportista</th><th style="text-align: right;">Asignados</th><th style="text-align: right;">Overflow</th></tr></thead>
  <tbody>
    ${carriersHtml}
    ${extra.length > 0 ? `<tr><td style="color: #c23;">EXTRA (sin transportista)</td><td style="text-align: right; font-weight: 700; color: #c23;">${extra.length}</td><td></td></tr>` : ""}
  </tbody>
</table>
` : ""}

<h2>SKUs totales</h2>
<div class="sku-grid">
  ${Object.entries(skuTotals).sort((a, b) => b[1] - a[1]).map(([sku, qty]) => `
    <div class="sku-item"><span class="sku-name">${sku}</span><span style="font-weight: 700;">×${qty}</span></div>
  `).join("")}
</div>

<div class="footer">Generado automáticamente el ${today}</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  // Save current state to history
  const saveToHistory = async (manual = false) => {
    setSavingHistory(true);
    try {
      const serializeShipment = (s) => ({
        type: s.type, cp: s.cp, envio: s.envio, destinatario: s.destinatario,
        localidad: s.localidad, tipoEnvio: s.tipoEnvio, direccion: s.direccion,
        barrio: s.barrio, referencia: s.referencia, fecha: s.fecha, items: s.items,
      });

      const entry = {
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        timestamp: Date.now(),
        client: currentClient || "Sin asignar",
        zonesSnapshot: zones.map((z) => ({ id: z.id, name: z.name, cps: [...z.cps] })),
        carrierAssignments: carrierAssignments.map((ca) => ({
          carrierName: ca.carrier.name,
          shipments: ca.shipments.map(serializeShipment),
        })),
        extra: extra.map(serializeShipment),
        colecta: colecta.map(serializeShipment),
        totals: {
          flex: flex.length,
          colecta: colecta.length,
          units: allItems.reduce((n, i) => n + i.qty, 0),
        },
      };

      await saveHistoryEntry(todayISO(), entry);
      setSavedToHistory(true);
      if (manual) toast("✓ Guardado en historial");
    } catch (e) {
      console.error("Error guardando historial:", e);
      toast("Error guardando en historial", "error");
    }
    setSavingHistory(false);
  };

  // Auto-save on mount
  useEffect(() => {
    if (shipments && shipments.length > 0 && !savedToHistory && !savingHistory) {
      saveToHistory();
    }
    // eslint-disable-next-line
  }, [shipments]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Client banner */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#e7eef5", border: "1px solid #c2cfde", borderRadius: 4, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🏢</span>
          <div>
            <div style={{ color: "#555555", fontSize: 11, fontWeight: 600 }}>CLIENTE</div>
            <div style={{ color: "#1e3a5f", fontSize: 15, fontWeight: 700 }}>{currentClient || "Sin asignar"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {savingHistory ? (
            <Badge color="gray">Guardando...</Badge>
          ) : savedToHistory ? (
            <>
              <Badge color="green">✓ Guardado en historial</Badge>
              <Btn small variant="ghost" onClick={() => saveToHistory(true)}>Actualizar</Btn>
            </>
          ) : (
            <Btn small variant="secondary" onClick={() => saveToHistory(true)}>💾 Guardar en historial</Btn>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Card accent="#60a5fa">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#1e3a5f" }}>{flex.length}</div>
            <div style={{ fontSize: 13, color: "#555555", fontWeight: 600 }}>Envíos FLEX</div>
          </div>
        </Card>
        <Card accent="#fb923c">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#b45309" }}>{colecta.length}</div>
            <div style={{ fontSize: 13, color: "#555555", fontWeight: 600 }}>Órdenes COLECTA</div>
          </div>
        </Card>
        <Card accent="#c084fc">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#6b21a8" }}>{allItems.reduce((s, i) => s + i.qty, 0)}</div>
            <div style={{ fontSize: 13, color: "#555555", fontWeight: 600 }}>Unidades totales</div>
          </div>
        </Card>
      </div>

      {/* Flex zone breakdown */}
      <Card title="Envíos FLEX por zona" icon="📍" accent="#60a5fa">
        {zones.length === 0 ? (
          <p style={{ color: "#8a8a7e", fontSize: 13 }}>Configurá zonas en la pestaña de configuración para ver el desglose</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {zoneBreakdown.map((zb) => (
              <div key={zb.zone.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2" }}>
                <span style={{ color: "#1a1a1a", fontWeight: 600, fontSize: 14 }}>{zb.zone.name}</span>
                <Badge color={zb.count > 0 ? "blue" : "gray"}>{zb.count} envío{zb.count !== 1 ? "s" : ""}</Badge>
              </div>
            ))}
            {noZone.length > 0 && (
              <UnassignedCPs noZoneShipments={noZone} zones={zones} setZones={setZones} />
            )}
          </div>
        )}
      </Card>

      {/* SKU breakdown - unified */}
      <Card title="SKUs totales" icon="📦" accent="#c084fc">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {groupSkus(allItems).map(([sku, qty]) => (
            <div key={sku} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", background: "#faf8f3", borderRadius: 3 }}>
              <span style={{ color: "#1a1a1a", fontSize: 13, fontFamily: "monospace" }}>{sku}</span>
              <Badge color="purple">×{qty}</Badge>
            </div>
          ))}
          {allItems.length === 0 && <p style={{ color: "#8a8a7e", fontSize: 13 }}>—</p>}
        </div>
      </Card>

      {/* Carrier assignment */}
      <Card title="Asignación por transportista" icon="🚛" accent="#4ade80">
        {Object.keys(manualOverrides).length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#f1e7f7", border: "1px solid #d5b9df", borderRadius: 3, marginBottom: 10 }}>
            <span style={{ color: "#6b21a8", fontSize: 12 }}>
              ✎ {Object.keys(manualOverrides).length} envío{Object.keys(manualOverrides).length !== 1 ? "s" : ""} movido{Object.keys(manualOverrides).length !== 1 ? "s" : ""} manualmente
            </span>
            <Btn small variant="ghost" onClick={() => setManualOverrides({})}>Deshacer todo</Btn>
          </div>
        )}
        {carriers.length === 0 ? (
          <p style={{ color: "#8a8a7e", fontSize: 13 }}>Configurá transportistas para ver la asignación y generar TXTs</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {carrierAssignments.map((ca) => (
              <div key={ca.carrier.id} style={{ padding: "12px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ca.shipments.length ? 8 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#1a1a1a", fontWeight: 700, fontSize: 14 }}>{ca.carrier.name}</span>
                    {ca.carrier.limit && <Badge color="orange">Tope: {ca.carrier.limit}</Badge>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge color="green">{ca.shipments.length} envío{ca.shipments.length !== 1 ? "s" : ""}</Badge>
                    {ca.shipments.length > 0 && (
                      <>
                        <Btn small variant="secondary" onClick={() => printCarrierSummary(ca.carrier, ca.shipments)}>
                          🖨️ Hoja
                        </Btn>
                        <Btn small variant="secondary" onClick={() => download(`${ca.carrier.name.replace(/\s+/g, "_")}.txt`, generateTXT(ca.shipments))}>
                          ⬇ TXT
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
                {ca.shipments.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {ca.shipments.map((s) => (
                      <EnvioChip
                        key={s.uid || s.envio}
                        shipment={s}
                        currentLocation={ca.carrier.id}
                        carriers={carriers}
                        isOverride={!!manualOverrides[s.envio]}
                        onMove={(target) => moveEnvio(s.envio, target)}
                        onClearOverride={() => clearOverride(s.envio)}
                      />
                    ))}
                  </div>
                )}
                {ca.overflow.length > 0 && (
                  <p style={{ color: "#b45309", fontSize: 12, margin: "6px 0 0 0" }}>
                    ⚠ {ca.overflow.length} envío(s) exceden el tope → van a EXTRA
                  </p>
                )}
              </div>
            ))}
            {/* Extra */}
            <div style={{ padding: "12px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #e0b5b5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: extra.length ? 8 : 0 }}>
                <span style={{ color: "#b91c1c", fontWeight: 700, fontSize: 14 }}>EXTRA (sin transportista)</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge color="red">{extra.length} envío{extra.length !== 1 ? "s" : ""}</Badge>
                  {extra.length > 0 && (
                    <>
                      <Btn small variant="secondary" onClick={() => printCarrierSummary({ name: "EXTRA (sin transportista)" }, extra)}>
                        🖨️ Hoja
                      </Btn>
                      <Btn small variant="secondary" onClick={() => download("EXTRA_sin_transportista.txt", generateTXT(extra))}>
                        ⬇ TXT
                      </Btn>
                    </>
                  )}
                </div>
              </div>
              {extra.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {extra.map((s) => (
                    <EnvioChip
                      key={s.uid || s.envio || Math.random()}
                      shipment={s}
                      currentLocation="EXTRA"
                      carriers={carriers}
                      isOverride={s.envio && !!manualOverrides[s.envio]}
                      onMove={(target) => s.envio && moveEnvio(s.envio, target)}
                      onClearOverride={() => s.envio && clearOverride(s.envio)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Generate all + Report buttons */}
      {(carriers.length > 0 || zones.length > 0) && (flex.length > 0 || colecta.length > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {carriers.length > 0 && flex.length > 0 && (
            <Btn onClick={handleGenerateAll} style={{ flex: "1 1 200px", padding: "14px 20px", fontSize: 15, justifyContent: "center", borderRadius: 4 }}>
              ⬇ Generar todos los TXT
            </Btn>
          )}
          <Btn onClick={printGeneralReport} variant="secondary" style={{ flex: "1 1 200px", padding: "14px 20px", fontSize: 15, justifyContent: "center", borderRadius: 4 }}>
            🖨️ Reporte general (PDF)
          </Btn>
        </div>
      )}

      {/* Detail table */}
      <DetailTable flex={flex} carrierAssignments={carrierAssignments} carriers={carriers} />
    </div>
  );
}

// ─── Label Preview Modal ───
function LabelPreview({ shipment, carrier, onClose }) {
  if (!shipment) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff", border: "1px solid #c9c3b2", borderRadius: 4,
          padding: 24, maxWidth: 520, width: "100%", maxHeight: "90vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #c9c3b2" }}>
          <div>
            <h3 style={{ color: "#1a1a1a", fontSize: 16, fontWeight: 700, margin: 0 }}>
              {shipment.type === "FLEX" ? "📦 Envío FLEX" : "📋 Orden COLECTA"}
            </h3>
            {shipment.envio && (
              <p style={{ color: "#555555", fontSize: 12, fontFamily: "monospace", margin: "2px 0 0 0" }}>
                #{shipment.envio}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "1px solid #c9c3b2", borderRadius: 3, padding: "4px 10px", color: "#555555", cursor: "pointer", fontSize: 14 }}
          >
            ✕
          </button>
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* CP + Tipo + Fecha */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {shipment.cp && (
              <div style={{ flex: "1 1 auto", padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#555555", marginBottom: 2 }}>CÓDIGO POSTAL</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a5f" }}>{shipment.cp}</div>
              </div>
            )}
            {shipment.tipoEnvio && (
              <div style={{ flex: "1 1 auto", padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#555555", marginBottom: 2 }}>TIPO</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: shipment.tipoEnvio === "COMERCIAL" ? "#15803d" : "#555555", paddingTop: 4 }}>
                  {shipment.tipoEnvio}
                </div>
              </div>
            )}
            {shipment.fecha && (
              <div style={{ flex: "1 1 auto", padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#555555", marginBottom: 2 }}>FECHA</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#b45309", paddingTop: 4 }}>{shipment.fecha}</div>
              </div>
            )}
          </div>

          {/* Destinatario */}
          {shipment.destinatario && (
            <InfoRow label="Destinatario" value={shipment.destinatario} />
          )}

          {/* Dirección */}
          {shipment.direccion && (
            <InfoRow label="Dirección" value={shipment.direccion} />
          )}

          {/* Localidad + Barrio */}
          {(shipment.localidad || shipment.barrio) && (
            <div style={{ display: "flex", gap: 8 }}>
              {shipment.localidad && <InfoRow label="Localidad" value={shipment.localidad} style={{ flex: 1 }} />}
              {shipment.barrio && <InfoRow label="Barrio" value={shipment.barrio} style={{ flex: 1 }} />}
            </div>
          )}

          {/* Referencia */}
          {shipment.referencia && (
            <InfoRow label="Referencia" value={shipment.referencia} />
          )}

          {/* Items */}
          <div style={{ padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2" }}>
            <div style={{ fontSize: 11, color: "#555555", marginBottom: 6 }}>ITEMS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {shipment.items.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                  <span style={{ color: "#1a1a1a", fontSize: 13, fontFamily: "monospace" }}>{it.sku}</span>
                  <Badge color="purple">×{it.qty}</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Transportista */}
          <div style={{ padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#555555" }}>TRANSPORTISTA</span>
            {carrier ? <Badge color="green">{carrier.name}</Badge> : <Badge color="red">EXTRA</Badge>}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, style }) {
  return (
    <div style={{ padding: "10px 14px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", ...style }}>
      <div style={{ fontSize: 11, color: "#555555", marginBottom: 2 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 14, color: "#1a1a1a" }}>{value}</div>
    </div>
  );
}

// ─── Detail Table with search/filter ───
function DetailTable({ flex, carrierAssignments, carriers }) {
  const [search, setSearch] = useState("");
  const [filterCarrier, setFilterCarrier] = useState("all");
  const [filterTipo, setFilterTipo] = useState("all");
  const [previewShipment, setPreviewShipment] = useState(null);

  // Find which carrier a specific label belongs to (by reference, not envio)
  const getCarrier = (shipment) => carrierAssignments.find((ca) => ca.shipments.includes(shipment));

  const filtered = flex.filter((s) => {
    // Carrier filter
    if (filterCarrier !== "all") {
      const ca = getCarrier(s);
      if (filterCarrier === "extra") {
        if (ca) return false;
      } else {
        if (!ca || String(ca.carrier.id) !== String(filterCarrier)) return false;
      }
    }
    // Tipo filter
    if (filterTipo !== "all" && s.tipoEnvio !== filterTipo) return false;
    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = [s.envio, s.cp, s.destinatario, s.localidad, ...(s.items || []).map((i) => i.sku)]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <Card title="Detalle de envíos FLEX" icon="📋">
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Input
          value={search}
          onChange={setSearch}
          placeholder="🔍 Buscar por envío, CP, destinatario, SKU..."
          style={{ flex: "1 1 240px", fontSize: 13 }}
        />
        <select
          value={filterCarrier}
          onChange={(e) => setFilterCarrier(e.target.value)}
          style={{ background: "#faf8f3", border: "1px solid #c9c3b2", borderRadius: 3, padding: "8px 12px", color: "#1a1a1a", fontSize: 13, outline: "none", cursor: "pointer" }}
        >
          <option value="all">Todos los transportistas</option>
          {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="extra">EXTRA</option>
        </select>
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          style={{ background: "#faf8f3", border: "1px solid #c9c3b2", borderRadius: 3, padding: "8px 12px", color: "#1a1a1a", fontSize: 13, outline: "none", cursor: "pointer" }}
        >
          <option value="all">Todos los tipos</option>
          <option value="COMERCIAL">Comercial</option>
          <option value="RESIDENCIAL">Residencial</option>
        </select>
        {(search || filterCarrier !== "all" || filterTipo !== "all") && (
          <Btn small variant="ghost" onClick={() => { setSearch(""); setFilterCarrier("all"); setFilterTipo("all"); }}>Limpiar</Btn>
        )}
      </div>

      {/* Count */}
      <div style={{ color: "#555555", fontSize: 12, marginBottom: 8 }}>
        Mostrando {filtered.length} de {flex.length} envío{flex.length !== 1 ? "s" : ""}
      </div>

      <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto", border: "1px solid #c9c3b2", borderRadius: 3 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              {["#Envío", "CP", "Tipo", "Destinatario", "Localidad", "Items", "Transportista"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 10px", color: "#1a1a1a", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", background: "#f0ece2", borderBottom: "2px solid #a8a08a" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, idx) => {
              const assignedCarrier = getCarrier(s);
              return (
                <tr
                  key={s.uid || s.envio}
                  onClick={() => setPreviewShipment(s)}
                  style={{ borderBottom: "1px solid #e5e1d5", cursor: "pointer", transition: "background .1s", background: idx % 2 === 0 ? "#ffffff" : "#faf8f3" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#fef3e7"}
                  onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? "#ffffff" : "#faf8f3"}
                >
                  <td style={{ padding: "8px 10px", color: "#1a1a1a", fontFamily: "monospace" }}>{s.envio}</td>
                  <td style={{ padding: "8px 10px" }}><Badge color="blue">{s.cp}</Badge></td>
                  <td style={{ padding: "8px 10px" }}>
                    <Badge color={s.tipoEnvio === "COMERCIAL" ? "green" : "gray"}>{s.tipoEnvio || "—"}</Badge>
                  </td>
                  <td style={{ padding: "8px 10px", color: "#2a2a2a", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.destinatario}</td>
                  <td style={{ padding: "8px 10px", color: "#555555" }}>{s.localidad}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {s.items.map((it, j) => (
                        <Badge key={j} color="purple">{it.sku} ×{it.qty}</Badge>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {assignedCarrier ? <Badge color="green">{assignedCarrier.carrier.name}</Badge> : <Badge color="red">EXTRA</Badge>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#8a8a7e", fontSize: 13 }}>
                  No se encontraron envíos con esos filtros
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: "#8a8a7e", fontSize: 11, marginTop: 8, textAlign: "center" }}>
        💡 Click en cualquier fila para ver los detalles completos
      </p>
      <LabelPreview
        shipment={previewShipment}
        carrier={previewShipment ? getCarrier(previewShipment)?.carrier : null}
        onClose={() => setPreviewShipment(null)}
      />
    </Card>
  );
}

// ─── History Panel ───
function HistoryPanel() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const d = await loadHistoryDates();
      setDates(d);
      if (d.length > 0) setSelectedDate(d[0]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedDate) { setEntries([]); return; }
    (async () => {
      const e = await loadHistoryDay(selectedDate);
      setEntries(e);
    })();
  }, [selectedDate]);

  const handleDelete = async (entryId) => {
    if (!confirm("¿Borrar esta entrada del historial?")) return;
    await deleteHistoryEntry(selectedDate, entryId);
    const e = await loadHistoryDay(selectedDate);
    setEntries(e);
    // If no entries left, refresh dates
    if (e.length === 0) {
      const d = await loadHistoryDates();
      setDates(d);
      setSelectedDate(d.length > 0 ? d[0] : null);
    }
  };

  // Group entries by client
  const byClient = {};
  for (const entry of entries) {
    const c = entry.client || "Sin asignar";
    if (!byClient[c]) byClient[c] = [];
    byClient[c].push(entry);
  }

  // Format date for display
  const formatDate = (iso) => {
    const [y, m, d] = iso.split("-");
    const date = new Date(+y, +m - 1, +d);
    return date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };

  // Print day report - if clientFilter is given, only that client; otherwise all
  const printDaySummary = (clientFilter = null) => {
    if (!selectedDate || entries.length === 0) return;

    const clientsToShow = clientFilter
      ? { [clientFilter]: byClient[clientFilter] || [] }
      : byClient;

    const clientsHtml = Object.entries(clientsToShow).map(([client, list]) => {
      // Aggregate all data for this client across entries
      const allCarrierAssignments = {};
      let allExtra = [];
      let allColecta = [];
      const allItems = [];
      let totalFlex = 0, totalColecta = 0, totalUnits = 0;

      for (const entry of list) {
        totalFlex += entry.totals?.flex || 0;
        totalColecta += entry.totals?.colecta || 0;
        totalUnits += entry.totals?.units || 0;

        for (const ca of (entry.carrierAssignments || [])) {
          if (!allCarrierAssignments[ca.carrierName]) allCarrierAssignments[ca.carrierName] = [];
          allCarrierAssignments[ca.carrierName].push(...ca.shipments);
          for (const s of ca.shipments) allItems.push(...(s.items || []));
        }
        allExtra = allExtra.concat(entry.extra || []);
        allColecta = allColecta.concat(entry.colecta || []);
        for (const s of (entry.extra || [])) allItems.push(...(s.items || []));
        for (const s of (entry.colecta || [])) allItems.push(...(s.items || []));
      }

      const skuTotals = {};
      for (const it of allItems) skuTotals[it.sku] = (skuTotals[it.sku] || 0) + it.qty;

      const carriersHtml = Object.entries(allCarrierAssignments).map(([cname, ships]) => `
        <h4 class="carrier-header">🚛 ${cname} <span class="count">(${ships.length} envío${ships.length !== 1 ? "s" : ""})</span></h4>
        <table>
          <thead><tr><th>#</th><th>CP</th><th>Destinatario</th><th>Dirección</th><th>Localidad</th><th>Items</th></tr></thead>
          <tbody>
            ${ships.map((s, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${s.cp || "—"}</strong></td>
                <td>${s.destinatario || "—"}</td>
                <td>${s.direccion || "—"}</td>
                <td>${s.localidad || "—"}</td>
                <td>${(s.items || []).map((it) => `${it.sku} ×${it.qty}`).join(", ")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `).join("");

      const extraHtml = allExtra.length > 0 ? `
        <h4 class="carrier-header warning">⚠ EXTRA (sin transportista) <span class="count">(${allExtra.length})</span></h4>
        <table>
          <thead><tr><th>#</th><th>CP</th><th>Destinatario</th><th>Dirección</th><th>Items</th></tr></thead>
          <tbody>
            ${allExtra.map((s, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${s.cp || "—"}</strong></td>
                <td>${s.destinatario || "—"}</td>
                <td>${s.direccion || "—"}</td>
                <td>${(s.items || []).map((it) => `${it.sku} ×${it.qty}`).join(", ")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : "";

      const colectaHtml = allColecta.length > 0 ? `
        <h4 class="carrier-header">📋 COLECTA <span class="count">(${allColecta.length})</span></h4>
        <table>
          <thead><tr><th>#</th><th>CP</th><th>Items</th></tr></thead>
          <tbody>
            ${allColecta.map((s, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${s.cp || "—"}</td>
                <td>${(s.items || []).map((it) => `${it.sku} ×${it.qty}`).join(", ")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : "";

      return `
        <div class="client-section">
          <h2 class="client-header">🏢 ${client}</h2>
          <div class="client-meta">
            <span><strong>${list.length}</strong> carga${list.length !== 1 ? "s" : ""}</span>
            <span><strong>${totalFlex}</strong> FLEX</span>
            <span><strong>${totalColecta}</strong> COLECTA</span>
            <span><strong>${totalUnits}</strong> unidades</span>
          </div>
          ${carriersHtml}
          ${extraHtml}
          ${colectaHtml}
          <div class="sku-summary">
            <strong>Productos del cliente:</strong>
            <div class="sku-grid">
              ${Object.entries(skuTotals).sort((a, b) => b[1] - a[1]).map(([sku, qty]) => `
                <span class="sku-item"><code>${sku}</code> <strong>×${qty}</strong></span>
              `).join("")}
            </div>
          </div>
        </div>
      `;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${clientFilter ? `${clientFilter} - ${formatDate(selectedDate)}` : `Resumen diario - ${formatDate(selectedDate)}`}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; color: #222; margin: 0; padding: 24px; }
  h1 { margin: 0 0 4px 0; font-size: 26px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 24px; text-transform: capitalize; }
  .client-section { margin-bottom: 40px; padding: 20px; background: #fafafa; border-radius: 10px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .client-header { font-size: 20px; margin: 0 0 10px 0; padding-bottom: 8px; border-bottom: 3px solid #1a1a1a; }
  .client-meta { display: flex; gap: 20px; padding: 10px 14px; background: white; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
  .carrier-header { font-size: 14px; margin: 16px 0 8px 0; padding: 6px 10px; background: #1a1a1a; color: white; border-radius: 4px; }
  .carrier-header.warning { background: #c23; }
  .count { font-weight: normal; opacity: 0.8; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; background: white; }
  th { text-align: left; padding: 6px 8px; background: #f0f0f0; border-bottom: 1px solid #ccc; font-weight: 700; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .sku-summary { margin-top: 16px; padding: 12px 14px; background: white; border-radius: 6px; font-size: 13px; }
  .sku-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .sku-item { padding: 3px 8px; background: #f0f0f0; border-radius: 3px; font-size: 11px; }
  .sku-item code { font-family: monospace; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 12px; } .no-print { display: none; } .client-section { background: white; } }
  .no-print { position: fixed; top: 10px; right: 10px; }
  .no-print button { background: #1a1a1a; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
</style></head>
<body>
<div class="no-print"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<h1>${clientFilter ? `Resumen · ${clientFilter}` : "Resumen del día"}</h1>
<div class="subtitle">${formatDate(selectedDate)}</div>
${clientsHtml}
<div class="footer">Generado el ${new Date().toLocaleString("es-AR")}</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  if (loading) {
    return <Card><p style={{ textAlign: "center", color: "#8a8a7e", padding: 40 }}>Cargando historial...</p></Card>;
  }

  if (dates.length === 0) {
    return (
      <Card>
        <p style={{ textAlign: "center", color: "#8a8a7e", padding: 40 }}>
          📚 Aún no hay entradas en el historial.<br/>
          <span style={{ fontSize: 12 }}>Cuando proceses archivos, las cargas se van a guardar automáticamente acá.</span>
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Date selector */}
      <Card title="Seleccioná un día" icon="📅" accent="#60a5fa">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {dates.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDate(d)}
              style={{
                padding: "8px 14px", borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: selectedDate === d ? "#e7eef5" : "#ffffff",
                color: selectedDate === d ? "#1e3a5f" : "#555555",
                border: `1px solid ${selectedDate === d ? "#c2cfde" : "#c9c3b2"}`,
              }}
            >
              {formatDate(d)}
            </button>
          ))}
        </div>
      </Card>

      {/* Day summary */}
      {selectedDate && (
        <>
          <Card title={`Resumen del ${formatDate(selectedDate)}`} icon="📊" accent="#4ade80">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
              <div style={{ padding: 12, background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#1e3a5f" }}>{entries.length}</div>
                <div style={{ fontSize: 11, color: "#555555" }}>Cargas</div>
              </div>
              <div style={{ padding: 12, background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d" }}>{Object.keys(byClient).length}</div>
                <div style={{ fontSize: 11, color: "#555555" }}>Clientes</div>
              </div>
              <div style={{ padding: 12, background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#b45309" }}>{entries.reduce((n, e) => n + (e.totals?.flex || 0), 0)}</div>
                <div style={{ fontSize: 11, color: "#555555" }}>FLEX</div>
              </div>
              <div style={{ padding: 12, background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#6b21a8" }}>{entries.reduce((n, e) => n + (e.totals?.units || 0), 0)}</div>
                <div style={{ fontSize: 11, color: "#555555" }}>Unidades</div>
              </div>
            </div>
            <Btn onClick={() => printDaySummary()} style={{ width: "100%", padding: "12px 20px", fontSize: 14, justifyContent: "center", borderRadius: 4 }}>
              🖨️ Imprimir resumen del día (todos los clientes)
            </Btn>
          </Card>

          {/* Entries by client */}
          {Object.entries(byClient).map(([client, list]) => (
            <Card key={client} title={`🏢 ${client}`} accent="#60a5fa">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: "#555555" }}>
                  {list.length} carga{list.length !== 1 ? "s" : ""} · {list.reduce((n, e) => n + (e.totals?.flex || 0), 0)} FLEX · {list.reduce((n, e) => n + (e.totals?.colecta || 0), 0)} COLECTA · {list.reduce((n, e) => n + (e.totals?.units || 0), 0)} unidades
                </div>
                <Btn small variant="secondary" onClick={() => printDaySummary(client)}>
                  🖨️ Imprimir este cliente
                </Btn>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {list.map((entry) => {
                  const time = new Date(entry.timestamp).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={entry.id} style={{ padding: "8px 12px", background: "#faf8f3", borderRadius: 3, border: "1px solid #c9c3b2", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ color: "#555555", fontSize: 12, fontFamily: "monospace" }}>{time}</span>
                        <Badge color="blue">{entry.totals?.flex || 0} FLEX</Badge>
                        {entry.totals?.colecta > 0 && <Badge color="orange">{entry.totals.colecta} COLECTA</Badge>}
                        <Badge color="purple">{entry.totals?.units || 0} u.</Badge>
                        {entry.carrierAssignments && entry.carrierAssignments.length > 0 && (
                          <span style={{ color: "#8a8a7e", fontSize: 11 }}>
                            → {entry.carrierAssignments.filter((ca) => ca.shipments.length > 0).map((ca) => `${ca.carrierName} (${ca.shipments.length})`).join(", ")}
                            {entry.extra && entry.extra.length > 0 ? `, EXTRA (${entry.extra.length})` : ""}
                          </span>
                        )}
                      </div>
                      <Btn small variant="ghost" onClick={() => handleDelete(entry.id)}>✕</Btn>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [tab, setTab] = useState("upload");
  const [zones, setZones] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [shipments, setShipments] = useState(null);
  const [currentClient, setCurrentClient] = useState(null);
  const [clients, setClients] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Load from server
  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      setZones(config.zones || []);
      setCarriers(config.carriers || []);
      const clientList = await loadClients();
      setClients(clientList || []);
      setLoaded(true);
    })();
  }, []);

  // Save on change
  useEffect(() => { if (loaded) saveZones(zones); }, [zones, loaded]);
  useEffect(() => { if (loaded) saveCarriers(carriers); }, [carriers, loaded]);

  const handleParsed = (s, clientName) => {
    setShipments(s);
    setCurrentClient(clientName || "Sin asignar");
    setTab("results");
  };

  const tabs = [
    { id: "upload", label: "Cargar archivo", icon: "📄" },
    { id: "config", label: "Configuración", icon: "⚙️" },
    { id: "results", label: "Resultados", icon: "📊" },
    { id: "history", label: "Historial", icon: "📚" },
  ];

  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', -apple-system, sans-serif", background: "#f5f2ea", color: "#1a1a1a", minHeight: "100vh", padding: "0" }}>
      {/* App header bar */}
      <header style={{ background: "#1a1a1a", color: "#fff", padding: "14px 24px", borderBottom: "3px solid #ea580c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 24, background: "#ea580c" }} />
          <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Gestor de Etiquetas
          </h1>
        </div>
        <span style={{ fontSize: 11, color: "#aaa", letterSpacing: "0.04em", textTransform: "uppercase" }}>Sistema de gestión 3PL</span>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />

        {tab === "upload" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <FileUpload onParsed={handleParsed} clients={clients} setClients={setClients} />
            {shipments && (
              <div style={{ padding: "12px 16px", background: "#e8f3ec", borderRadius: 3, border: "1px solid #b5d4bf", borderLeft: "4px solid #15803d" }}>
                <span style={{ color: "#15803d", fontWeight: 700, fontSize: 13 }}>
                  ✓ Archivo cargado ({currentClient}): {shipments.filter((s) => s.type === "FLEX").length} FLEX + {shipments.filter((s) => s.type === "COLECTA").length} COLECTA
                </span>
                <span style={{ color: "#555555", fontSize: 13 }}> — Ir a Resultados para ver el detalle</span>
              </div>
            )}
          </div>
        )}

        {tab === "config" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ZonesPanel zones={zones} setZones={setZones} />
            <CarriersPanel carriers={carriers} setCarriers={setCarriers} zones={zones} />
          </div>
        )}

        {tab === "results" && (
          shipments ? (
            <ResultsDashboard shipments={shipments} zones={zones} carriers={carriers} setZones={setZones} currentClient={currentClient} />
          ) : (
            <Card>
              <p style={{ textAlign: "center", color: "#8a8a7e", padding: 40 }}>
                Cargá un archivo primero en la pestaña "Cargar archivo"
              </p>
            </Card>
          )
        )}

        {tab === "history" && (
          <HistoryPanel />
        )}
      </div>
      <ToastContainer />
    </div>
  );
}
