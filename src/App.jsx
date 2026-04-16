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

function parseZPL(text) {
  const shipments = [];
  // Extract every individual ^XA...^XZ label
  const allLabels = text.match(/\^XA[\s\S]*?\^XZ/g);
  if (!allLabels) return shipments;

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

    let cp = null;
    let envioNum = null;
    let destinatario = null;
    let localidad = null;
    let tipoEnvio = null;

    if (isFlex) {
      // FLEX: CP is the big one below QR
      const cpM = lab.match(/FB890,1,0,C.*?FD(\d{4})/);
      const envM = lab.match(/Envio: (\d+)/);
      const destM = lab.match(/Destinatario: ([^\^(]+)/);
      const locM = lab.match(/FO0,660.*?FD([^\^]+)/);
      const tipoM = lab.match(/FO0,770.*?FD([^\^]+)/);
      if (cpM) cp = cpM[1];
      if (envM) envioNum = envM[1];
      if (destM) destinatario = destM[1].trim();
      if (locM) localidad = locM[1].replace(/_C3_[A-F0-9]{2}/g, "").trim();
      if (tipoM) tipoEnvio = tipoM[1].trim();
    } else {
      // COLECTA: CP from text pattern, deduplicated
      const cpMatches = lab.match(/CP[:\s]+(\d{4})/g);
      if (cpMatches) {
        const cps = cpMatches.map((m) => m.match(/(\d{4})/)[1]);
        cp = [...new Set(cps)][0]; // first unique CP
      }
    }

    shipments.push({
      type: isFlex ? "FLEX" : "COLECTA",
      cp,
      envio: envioNum,
      destinatario,
      localidad,
      tipoEnvio,
      items: [{ sku, qty }],
      rawLabels: [lab],
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

function Badge({ children, color = "blue" }) {
  const colors = {
    blue: { bg: "#1a2942", text: "#60a5fa", border: "#2a4a6b" },
    green: { bg: "#1a3328", text: "#4ade80", border: "#2a5a40" },
    orange: { bg: "#3b2a1a", text: "#fb923c", border: "#5a3a1a" },
    red: { bg: "#3b1a1a", text: "#f87171", border: "#5a2a2a" },
    purple: { bg: "#2a1a42", text: "#c084fc", border: "#3a2a5a" },
    gray: { bg: "#2a2a2a", text: "#a0a0a0", border: "#3a3a3a" },
  };
  const c = colors[color] || colors.blue;
  return (
    <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Card({ children, title, icon, accent, style }) {
  return (
    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 20, borderTop: accent ? `3px solid ${accent}` : undefined, ...style }}>
      {title && (
        <h3 style={{ margin: "0 0 14px 0", fontSize: 15, fontWeight: 700, color: "#e6edf3", display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
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
      style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", ...style }}
    />
  );
}

function Btn({ children, onClick, variant = "primary", disabled, style, small }) {
  const variants = {
    primary: { bg: "#238636", hover: "#2ea043", text: "#fff" },
    secondary: { bg: "#21262d", hover: "#30363d", text: "#c9d1d9" },
    danger: { bg: "#da3633", hover: "#f85149", text: "#fff" },
    ghost: { bg: "transparent", hover: "#21262d", text: "#8b949e" },
  };
  const v = variants[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ background: disabled ? "#21262d" : v.bg, color: disabled ? "#484f58" : v.text, border: "1px solid #30363d", borderRadius: 8, padding: small ? "4px 12px" : "8px 16px", fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", transition: "all .15s", display: "inline-flex", alignItems: "center", gap: 6, ...style }}
    >
      {children}
    </button>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "#0d1117", borderRadius: 10, padding: 3, marginBottom: 20 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all .15s",
            background: active === t.id ? "#238636" : "transparent",
            color: active === t.id ? "#fff" : "#8b949e",
          }}
        >
          {t.icon} {t.label}
        </button>
      ))}
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
          style={{ background: "none", border: "1px solid #30363d", borderRadius: 12, padding: "2px 8px", fontSize: 11, color: "#8b949e", cursor: "pointer", whiteSpace: "nowrap" }}
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
    <div style={{ padding: "10px 14px", background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: 14 }}>{zone.name}</span>
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
            <p style={{ color: "#f87171", fontSize: 12, margin: "6px 0 0 0" }}>⚠ {error}</p>
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
      <p style={{ color: "#8b949e", fontSize: 13, margin: "0 0 16px 0" }}>
        Agrupaciones de CPs para el resumen. Cada CP solo puede pertenecer a una zona.
      </p>

      {/* Existing duplicates warning */}
      {showExistingDupes && existingDupes.length > 0 && (
        <div style={{ padding: 14, background: "#3b2a1a", border: "1px solid #5a3a1a", borderRadius: 8, marginBottom: 12 }}>
          <p style={{ color: "#fb923c", fontSize: 13, fontWeight: 700, margin: "0 0 10px 0" }}>
            ⚠ Se encontraron CPs repetidos entre zonas. Elegí dónde querés que quede cada uno:
          </p>
          {existingDupes.map((d) => (
            <div key={d.cp} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <Badge color="orange">{d.cp}</Badge>
              <span style={{ color: "#8b949e", fontSize: 12 }}>está en:</span>
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
        <div style={{ padding: 14, background: "#1a2942", border: "1px solid #2a4a6b", borderRadius: 8, marginBottom: 12 }}>
          <p style={{ color: "#60a5fa", fontSize: 13, fontWeight: 700, margin: "0 0 10px 0" }}>
            Algunos CPs de "{conflicts.name}" ya existen en otras zonas. ¿Dónde los querés dejar?
          </p>
          {conflicts.duplicates.map((d) => (
            <div key={d.cp} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <Badge color="blue">{d.cp}</Badge>
              <span style={{ color: "#8b949e", fontSize: 12 }}>existe en {d.zoneName}:</span>
              <button
                onClick={() => setDupeSelections((prev) => ({ ...prev, [d.cp]: "new" }))}
                style={{
                  padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: dupeSelections[d.cp] === "new" ? "#238636" : "#21262d",
                  color: dupeSelections[d.cp] === "new" ? "#fff" : "#8b949e",
                  border: `1px solid ${dupeSelections[d.cp] === "new" ? "#238636" : "#30363d"}`,
                }}
              >
                Mover a {conflicts.name}
              </button>
              <button
                onClick={() => setDupeSelections((prev) => ({ ...prev, [d.cp]: d.zoneId }))}
                style={{
                  padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: dupeSelections[d.cp] !== "new" ? "#238636" : "#21262d",
                  color: dupeSelections[d.cp] !== "new" ? "#fff" : "#8b949e",
                  border: `1px solid ${dupeSelections[d.cp] !== "new" ? "#238636" : "#30363d"}`,
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

      {zones.length === 0 && <p style={{ color: "#484f58", fontSize: 13, textAlign: "center", padding: 20 }}>No hay zonas configuradas</p>}
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
    <div style={{ padding: "12px 14px", background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: 14 }}>{carrier.name}</span>
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
              style={{ background: "#3b2a1a", color: "#fb923c", border: "1px solid #5a3a1a", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              {carrier.limit ? `Tope total: ${carrier.limit}` : "Tope total: ∞"}
            </button>
          )}
          <button
            onClick={togglePriority}
            style={{
              background: prio === "COMERCIAL" ? "#1a3328" : "#1a2942",
              color: prio === "COMERCIAL" ? "#4ade80" : "#60a5fa",
              border: `1px solid ${prio === "COMERCIAL" ? "#2a5a40" : "#2a4a6b"}`,
              borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer",
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
      <div style={{ marginTop: 8, padding: "8px 10px", background: "#161b22", borderRadius: 6, border: "1px solid #21262d" }}>
        {editingPrioCps ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#c084fc", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>CPs prioritarios:</span>
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
              <span style={{ color: "#c084fc", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>CPs prioritarios:</span>
              {hasPrioCps ? (
                <CollapsibleCPs cps={carrier.priorityCps} color="purple" previewCount={5} />
              ) : (
                <span style={{ color: "#484f58", fontSize: 12 }}>Sin configurar</span>
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
        <div style={{ marginTop: 6, padding: "8px 10px", background: "#161b22", borderRadius: 6, border: "1px solid #21262d" }}>
          {editingZoneLimits ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: "#fb923c", fontSize: 12, fontWeight: 600 }}>Topes por zona:</span>
              {zones.map((z) => (
                <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#c9d1d9", fontSize: 12, minWidth: 80 }}>{z.name}:</span>
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
                <span style={{ color: "#fb923c", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>Topes por zona:</span>
                {hasZoneLimits ? (
                  zones.filter((z) => zoneLimits[z.id]).map((z) => (
                    <Badge key={z.id} color="orange">{z.name}: {zoneLimits[z.id]}</Badge>
                  ))
                ) : (
                  <span style={{ color: "#484f58", fontSize: 12 }}>Sin configurar</span>
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
      <p style={{ color: "#8b949e", fontSize: 13, margin: "0 0 16px 0" }}>
        Cada transportista tiene CPs asignados, un tope opcional y prioridad por tipo de envío. Los CPs prioritarios se configuran en cada tarjeta.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Input value={name} onChange={setName} placeholder="Nombre" style={{ flex: "1 1 120px" }} />
        <Input value={cps} onChange={setCps} placeholder="CPs asignados: 1000, 1001, 1036" style={{ flex: "2 1 220px" }} />
        <Input value={limit} onChange={setLimit} placeholder="Tope (vacío=sin tope)" type="number" style={{ flex: "0 1 130px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
          <span style={{ color: "#8b949e", fontSize: 12 }}>Priorizar:</span>
          <button
            onClick={() => setPriority(priority === "COMERCIAL" ? "RESIDENCIAL" : "COMERCIAL")}
            style={{
              background: priority === "COMERCIAL" ? "#1a3328" : "#1a2942",
              color: priority === "COMERCIAL" ? "#4ade80" : "#60a5fa",
              border: `1px solid ${priority === "COMERCIAL" ? "#2a5a40" : "#2a4a6b"}`,
              borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            {priority}
          </button>
        </div>
        <Btn onClick={add} variant="primary" disabled={!name.trim() || !cps.trim()}>+ Agregar</Btn>
      </div>
      {carriers.length === 0 && <p style={{ color: "#484f58", fontSize: 13, textAlign: "center", padding: 20 }}>No hay transportistas configurados</p>}
      {carriers.map((c) => (
        <CarrierCard key={c.id} carrier={c} onRemove={() => remove(c.id)} onUpdate={update} zones={zones} />
      ))}
    </Card>
  );
}

// ─── File Upload ───
function FileUpload({ onParsed }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
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
      onParsed(allShipments);
    } catch (e) {
      setError("Error al procesar: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); addFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragging ? "#238636" : "#30363d"}`, borderRadius: 12, padding: 30,
          textAlign: "center", transition: "all .2s",
          background: dragging ? "#0d1117" : "#161b22",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
        <p style={{ color: "#e6edf3", fontSize: 15, fontWeight: 600, margin: "0 0 4px 0" }}>
          Arrastrá tus archivos TXT acá
        </p>
        <p style={{ color: "#8b949e", fontSize: 13, margin: "0 0 14px 0" }}>
          Podés cargar varios archivos a la vez
        </p>
        <label style={{
          display: "inline-block", background: "#238636", color: "#fff", padding: "10px 24px",
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
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
            <span style={{ color: "#e6edf3", fontSize: 14, fontWeight: 600 }}>
              {files.length} archivo{files.length !== 1 ? "s" : ""} cargado{files.length !== 1 ? "s" : ""}
            </span>
            <Btn small variant="ghost" onClick={() => setFiles([])}>Limpiar todo</Btn>
          </div>
          {files.map((f) => (
            <div key={f.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: "#0d1117", borderRadius: 6, border: "1px solid #21262d" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#8b949e", fontSize: 14 }}>📄</span>
                <span style={{ color: "#c9d1d9", fontSize: 13 }}>{f.name}</span>
                <span style={{ color: "#484f58", fontSize: 11 }}>({(f.size / 1024).toFixed(1)} KB)</span>
              </div>
              <Btn variant="ghost" small onClick={() => removeFile(f.name)}>✕</Btn>
            </div>
          ))}
          <Btn
            onClick={processAll}
            disabled={loading}
            style={{ width: "100%", padding: "14px 20px", fontSize: 15, justifyContent: "center", borderRadius: 10, marginTop: 4 }}
          >
            {loading ? "Procesando..." : "🚀 COMENZAR"}
          </Btn>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", background: "#3b1a1a", border: "1px solid #5a2a2a", borderRadius: 8, color: "#f87171", fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

// ─── Results Dashboard ───
function ResultsDashboard({ shipments, zones, carriers }) {
  const flex = shipments.filter((s) => s.type === "FLEX");
  const colecta = shipments.filter((s) => s.type === "COLECTA");

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

  for (const c of carriers) {
    const matching = flex.filter((s) => s.cp && c.cps.includes(s.cp) && !assigned.has(s.envio));

    // Sort by priority
    const priorityType = c.priority || "COMERCIAL";
    const prioCps = (c.priorityCps || []).map(Number);

    matching.sort((a, b) => {
      // 1) Type priority: preferred type first
      const aTypeScore = (a.tipoEnvio === priorityType) ? 0 : 1;
      const bTypeScore = (b.tipoEnvio === priorityType) ? 0 : 1;
      if (aTypeScore !== bTypeScore) return aTypeScore - bTypeScore;

      // 2) CP priority: exact match first, then closest numerically
      if (prioCps.length > 0) {
        const aCp = Number(a.cp);
        const bCp = Number(b.cp);
        const aExact = prioCps.includes(aCp) ? 0 : 1;
        const bExact = prioCps.includes(bCp) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        const aMinDist = Math.min(...prioCps.map((p) => Math.abs(aCp - p)));
        const bMinDist = Math.min(...prioCps.map((p) => Math.abs(bCp - p)));
        if (aMinDist !== bMinDist) return aMinDist - bMinDist;
      }

      return 0;
    });

    // Apply zone limits + total limit
    const zoneLimits = c.zoneLimits || {};
    const zoneCounts = {};
    const taken = [];
    const overflow = [];

    for (const s of matching) {
      // Check total limit
      if (c.limit && taken.length >= c.limit) {
        overflow.push(s);
        continue;
      }
      // Check zone limit
      const zone = getZoneForCP(s.cp);
      if (zone && zoneLimits[zone.id]) {
        const count = zoneCounts[zone.id] || 0;
        if (count >= zoneLimits[zone.id]) {
          overflow.push(s);
          continue;
        }
        zoneCounts[zone.id] = count + 1;
      }
      taken.push(s);
    }

    taken.forEach((s) => assigned.add(s.envio));
    carrierAssignments.push({ carrier: c, shipments: taken, overflow });
  }
  const extra = flex.filter((s) => !assigned.has(s.envio));

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
  };

  const handleGenerateAll = () => {
    for (const ca of carrierAssignments) {
      if (ca.shipments.length > 0) {
        const txt = generateTXT(ca.shipments);
        download(`${ca.carrier.name.replace(/\s+/g, "_")}.txt`, txt);
      }
    }
    if (extra.length > 0) {
      const txt = generateTXT(extra);
      download("EXTRA_sin_transportista.txt", txt);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Card accent="#60a5fa">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#60a5fa" }}>{flex.length}</div>
            <div style={{ fontSize: 13, color: "#8b949e", fontWeight: 600 }}>Envíos FLEX</div>
          </div>
        </Card>
        <Card accent="#fb923c">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#fb923c" }}>{colecta.length}</div>
            <div style={{ fontSize: 13, color: "#8b949e", fontWeight: 600 }}>Órdenes COLECTA</div>
          </div>
        </Card>
        <Card accent="#c084fc">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#c084fc" }}>{allItems.reduce((s, i) => s + i.qty, 0)}</div>
            <div style={{ fontSize: 13, color: "#8b949e", fontWeight: 600 }}>Unidades totales</div>
          </div>
        </Card>
      </div>

      {/* Flex zone breakdown */}
      <Card title="Envíos FLEX por zona" icon="📍" accent="#60a5fa">
        {zones.length === 0 ? (
          <p style={{ color: "#484f58", fontSize: 13 }}>Configurá zonas en la pestaña de configuración para ver el desglose</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {zoneBreakdown.map((zb) => (
              <div key={zb.zone.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #21262d" }}>
                <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: 14 }}>{zb.zone.name}</span>
                <Badge color={zb.count > 0 ? "blue" : "gray"}>{zb.count} envío{zb.count !== 1 ? "s" : ""}</Badge>
              </div>
            ))}
            {noZone.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #3b1a1a" }}>
                <span style={{ color: "#f87171", fontWeight: 600, fontSize: 14 }}>Sin zona asignada</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#8b949e", fontSize: 12 }}>CPs: {[...new Set(noZone.map((s) => s.cp))].join(", ")}</span>
                  <Badge color="red">{noZone.length} envío{noZone.length !== 1 ? "s" : ""}</Badge>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* SKU breakdown - unified */}
      <Card title="SKUs totales" icon="📦" accent="#c084fc">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {groupSkus(allItems).map(([sku, qty]) => (
            <div key={sku} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", background: "#0d1117", borderRadius: 6 }}>
              <span style={{ color: "#e6edf3", fontSize: 13, fontFamily: "monospace" }}>{sku}</span>
              <Badge color="purple">×{qty}</Badge>
            </div>
          ))}
          {allItems.length === 0 && <p style={{ color: "#484f58", fontSize: 13 }}>—</p>}
        </div>
      </Card>

      {/* Carrier assignment */}
      <Card title="Asignación por transportista" icon="🚛" accent="#4ade80">
        {carriers.length === 0 ? (
          <p style={{ color: "#484f58", fontSize: 13 }}>Configurá transportistas para ver la asignación y generar TXTs</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {carrierAssignments.map((ca) => (
              <div key={ca.carrier.id} style={{ padding: "12px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #21262d" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ca.shipments.length ? 8 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#e6edf3", fontWeight: 700, fontSize: 14 }}>{ca.carrier.name}</span>
                    {ca.carrier.limit && <Badge color="orange">Tope: {ca.carrier.limit}</Badge>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge color="green">{ca.shipments.length} envío{ca.shipments.length !== 1 ? "s" : ""}</Badge>
                    {ca.shipments.length > 0 && (
                      <Btn small variant="secondary" onClick={() => download(`${ca.carrier.name.replace(/\s+/g, "_")}.txt`, generateTXT(ca.shipments))}>
                        ⬇ TXT
                      </Btn>
                    )}
                  </div>
                </div>
                {ca.shipments.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {ca.shipments.map((s) => (
                      <span key={s.envio} style={{ fontSize: 11, color: "#8b949e", background: "#161b22", padding: "2px 8px", borderRadius: 4, border: "1px solid #21262d" }}>
                        CP {s.cp} → {s.destinatario || s.envio}
                      </span>
                    ))}
                  </div>
                )}
                {ca.overflow.length > 0 && (
                  <p style={{ color: "#fb923c", fontSize: 12, margin: "6px 0 0 0" }}>
                    ⚠ {ca.overflow.length} envío(s) exceden el tope → van a EXTRA
                  </p>
                )}
              </div>
            ))}
            {/* Extra */}
            <div style={{ padding: "12px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #3b1a1a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: extra.length ? 8 : 0 }}>
                <span style={{ color: "#f87171", fontWeight: 700, fontSize: 14 }}>EXTRA (sin transportista)</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge color="red">{extra.length} envío{extra.length !== 1 ? "s" : ""}</Badge>
                  {extra.length > 0 && (
                    <Btn small variant="secondary" onClick={() => download("EXTRA_sin_transportista.txt", generateTXT(extra))}>
                      ⬇ TXT
                    </Btn>
                  )}
                </div>
              </div>
              {extra.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {extra.map((s) => (
                    <span key={s.envio || Math.random()} style={{ fontSize: 11, color: "#8b949e", background: "#161b22", padding: "2px 8px", borderRadius: 4, border: "1px solid #21262d" }}>
                      CP {s.cp} → {s.destinatario || s.envio || "Colecta"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Generate all button */}
      {carriers.length > 0 && flex.length > 0 && (
        <Btn onClick={handleGenerateAll} style={{ width: "100%", padding: "14px 20px", fontSize: 15, justifyContent: "center", borderRadius: 10 }}>
          ⬇ Generar todos los TXT
        </Btn>
      )}

      {/* Detail table */}
      <Card title="Detalle de envíos FLEX" icon="📋">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d" }}>
                {["#Envío", "CP", "Tipo", "Destinatario", "Localidad", "Items", "Transportista"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "#8b949e", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flex.map((s) => {
                const assignedCarrier = carrierAssignments.find((ca) => ca.shipments.some((cs) => cs.envio === s.envio));
                return (
                  <tr key={s.envio} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "8px 10px", color: "#e6edf3", fontFamily: "monospace" }}>{s.envio}</td>
                    <td style={{ padding: "8px 10px" }}><Badge color="blue">{s.cp}</Badge></td>
                    <td style={{ padding: "8px 10px" }}>
                      <Badge color={s.tipoEnvio === "COMERCIAL" ? "green" : "gray"}>{s.tipoEnvio || "—"}</Badge>
                    </td>
                    <td style={{ padding: "8px 10px", color: "#c9d1d9", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.destinatario}</td>
                    <td style={{ padding: "8px 10px", color: "#8b949e" }}>{s.localidad}</td>
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
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [tab, setTab] = useState("upload");
  const [zones, setZones] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [shipments, setShipments] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Load from server
  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      setZones(config.zones || []);
      setCarriers(config.carriers || []);
      setLoaded(true);
    })();
  }, []);

  // Save on change
  useEffect(() => { if (loaded) saveZones(zones); }, [zones, loaded]);
  useEffect(() => { if (loaded) saveCarriers(carriers); }, [carriers, loaded]);

  const handleParsed = (s) => {
    setShipments(s);
    setTab("results");
  };

  const tabs = [
    { id: "upload", label: "Cargar archivo", icon: "📄" },
    { id: "config", label: "Configuración", icon: "⚙️" },
    { id: "results", label: "Resultados", icon: "📊" },
  ];

  return (
    <div style={{ fontFamily: "'Segoe UI', -apple-system, sans-serif", background: "#0d1117", color: "#e6edf3", minHeight: "100vh", padding: "20px 16px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0", background: "linear-gradient(135deg, #60a5fa, #4ade80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            GESTOR DE ETIQUETAS
          </h1>
          <p style={{ color: "#484f58", fontSize: 13, margin: 0 }}>Procesá etiquetas de MercadoLibre y generá TXTs por transportista</p>
        </div>

        <TabBar tabs={tabs} active={tab} onChange={setTab} />

        {tab === "upload" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FileUpload onParsed={handleParsed} />
            {shipments && (
              <div style={{ textAlign: "center", padding: 16, background: "#1a3328", borderRadius: 10, border: "1px solid #2a5a40" }}>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>
                  ✓ Archivo cargado: {shipments.filter((s) => s.type === "FLEX").length} FLEX + {shipments.filter((s) => s.type === "COLECTA").length} COLECTA
                </span>
                <span style={{ color: "#8b949e", fontSize: 13 }}> — Ir a Resultados para ver el detalle</span>
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
            <ResultsDashboard shipments={shipments} zones={zones} carriers={carriers} />
          ) : (
            <Card>
              <p style={{ textAlign: "center", color: "#484f58", padding: 40 }}>
                Cargá un archivo primero en la pestaña "Cargar archivo"
              </p>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
