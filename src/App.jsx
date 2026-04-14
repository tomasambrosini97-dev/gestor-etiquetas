import { useState, useEffect, useRef, useCallback } from "react";

// ─── Helpers ───
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    return data;
  } catch { return { zones: [], carriers: [] }; }
}

async function saveZones(zones) {
  try { await fetch('/api/zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zones) }); } catch (e) { console.error(e); }
}

async function saveCarriers(carriers) {
  try { await fetch('/api/carriers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(carriers) }); } catch (e) { console.error(e); }
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
      rawLabel: lab,
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

// ─── Zones Panel ───
function ZonesPanel({ zones, setZones }) {
  const [name, setName] = useState("");
  const [cps, setCps] = useState("");

  const add = () => {
    if (!name.trim() || !cps.trim()) return;
    const cpList = cps.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
    setZones((prev) => [...prev, { id: Date.now(), name: name.trim(), cps: cpList }]);
    setName(""); setCps("");
  };
  const remove = (id) => setZones((prev) => prev.filter((z) => z.id !== id));

  return (
    <Card title="Zonas de envío" icon="🗺️" accent="#60a5fa">
      <p style={{ color: "#8b949e", fontSize: 13, margin: "0 0 16px 0" }}>
        Agrupaciones de CPs para el resumen. Ej: "CABA Centro" → 1000, 1001, 1036...
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Input value={name} onChange={setName} placeholder="Nombre de zona" style={{ flex: "1 1 150px" }} />
        <Input value={cps} onChange={setCps} placeholder="CPs separados por coma: 1000, 1001, 1036" style={{ flex: "2 1 250px" }} />
        <Btn onClick={add} disabled={!name.trim() || !cps.trim()}>+ Agregar</Btn>
      </div>
      {zones.length === 0 && <p style={{ color: "#484f58", fontSize: 13, textAlign: "center", padding: 20 }}>No hay zonas configuradas</p>}
      {zones.map((z) => (
        <div key={z.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: 14 }}>{z.name}</span>
            <Badge color="gray">{z.cps.length} CPs</Badge>
            <CollapsibleCPs cps={z.cps} color="blue" />
          </div>
          <Btn variant="ghost" small onClick={() => remove(z.id)}>✕</Btn>
        </div>
      ))}
    </Card>
  );
}

// ─── Carriers Panel ───
function CarriersPanel({ carriers, setCarriers }) {
  const [name, setName] = useState("");
  const [cps, setCps] = useState("");
  const [limit, setLimit] = useState("");
  const [priorityCps, setPriorityCps] = useState("");
  const [priority, setPriority] = useState("COMERCIAL");

  const add = () => {
    if (!name.trim() || !cps.trim()) return;
    const cpList = cps.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
    const prioCpList = priorityCps.trim() ? priorityCps.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean) : [];
    setCarriers((prev) => [...prev, {
      id: Date.now(),
      name: name.trim(),
      cps: cpList,
      limit: limit ? parseInt(limit) : null,
      priorityCps: prioCpList,
      priority,
    }]);
    setName(""); setCps(""); setLimit(""); setPriorityCps(""); setPriority("COMERCIAL");
  };
  const remove = (id) => setCarriers((prev) => prev.filter((c) => c.id !== id));
  const togglePriority = (id) => {
    setCarriers((prev) => prev.map((c) =>
      c.id === id ? { ...c, priority: c.priority === "COMERCIAL" ? "RESIDENCIAL" : "COMERCIAL" } : c
    ));
  };

  return (
    <Card title="Transportistas" icon="🚛" accent="#4ade80">
      <p style={{ color: "#8b949e", fontSize: 13, margin: "0 0 16px 0" }}>
        Cada transportista tiene CPs asignados, un tope opcional, CPs prioritarios y prioridad por tipo de envío.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Input value={name} onChange={setName} placeholder="Nombre" style={{ flex: "1 1 120px" }} />
          <Input value={cps} onChange={setCps} placeholder="CPs asignados: 1000, 1001, 1036" style={{ flex: "2 1 220px" }} />
          <Input value={limit} onChange={setLimit} placeholder="Tope (vacío=sin tope)" type="number" style={{ flex: "0 1 140px" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Input value={priorityCps} onChange={setPriorityCps} placeholder="CPs prioritarios (opcional): 1400, 1401" style={{ flex: "2 1 250px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <span style={{ color: "#8b949e", fontSize: 12 }}>Priorizar:</span>
            <button
              onClick={() => setPriority(priority === "COMERCIAL" ? "RESIDENCIAL" : "COMERCIAL")}
              style={{
                background: priority === "COMERCIAL" ? "#1a3328" : "#1a2942",
                color: priority === "COMERCIAL" ? "#4ade80" : "#60a5fa",
                border: `1px solid ${priority === "COMERCIAL" ? "#2a5a40" : "#2a4a6b"}`,
                borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              {priority}
            </button>
          </div>
          <Btn onClick={add} variant="primary" disabled={!name.trim() || !cps.trim()}>+ Agregar</Btn>
        </div>
      </div>
      {carriers.length === 0 && <p style={{ color: "#484f58", fontSize: 13, textAlign: "center", padding: 20 }}>No hay transportistas configurados</p>}
      {carriers.map((c) => (
        <div key={c.id} style={{ padding: "10px 14px", background: "#0d1117", borderRadius: 8, marginBottom: 6, border: "1px solid #21262d" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: (c.priorityCps && c.priorityCps.length > 0) ? 6 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#e6edf3", fontWeight: 600, fontSize: 14 }}>{c.name}</span>
              {c.limit && <Badge color="orange">Tope: {c.limit}</Badge>}
              <button
                onClick={() => togglePriority(c.id)}
                style={{
                  background: (c.priority || "COMERCIAL") === "COMERCIAL" ? "#1a3328" : "#1a2942",
                  color: (c.priority || "COMERCIAL") === "COMERCIAL" ? "#4ade80" : "#60a5fa",
                  border: `1px solid ${(c.priority || "COMERCIAL") === "COMERCIAL" ? "#2a5a40" : "#2a4a6b"}`,
                  borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}
              >
                Prioriza: {c.priority || "COMERCIAL"}
              </button>
              <Badge color="gray">{c.cps.length} CPs</Badge>
              <CollapsibleCPs cps={c.cps} color="green" />
            </div>
            <Btn variant="ghost" small onClick={() => remove(c.id)}>✕</Btn>
          </div>
          {c.priorityCps && c.priorityCps.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ color: "#8b949e", fontSize: 11 }}>CPs prioritarios:</span>
              <CollapsibleCPs cps={c.priorityCps} color="purple" previewCount={5} />
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

// ─── File Upload ───
function FileUpload({ onParsed }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  const processText = (text, fileName) => {
    try {
      const shipments = parseZPL(text);
      if (shipments.length === 0) {
        setError("No se encontraron etiquetas en el archivo. Asegurate de que sea un TXT con formato ZPL.");
        return;
      }
      setError(null);
      onParsed(shipments);
    } catch (e) {
      setError("Error al procesar: " + e.message);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);

    if (file.name.endsWith(".zip")) {
      setError("Los archivos ZIP no están soportados directamente. Descomprimí el ZIP primero y cargá el archivo .txt que tiene adentro.");
      setLoading(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setLoading(false);
      processText(e.target.result, file.name);
    };
    reader.onerror = () => {
      setLoading(false);
      setError("Error al leer el archivo");
    };
    reader.readAsText(file, "utf-8");
  };

  const handleInputChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    // Reset so same file can be loaded again
    e.target.value = "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        style={{
          border: `2px dashed ${dragging ? "#238636" : "#30363d"}`, borderRadius: 12, padding: 40,
          textAlign: "center", transition: "all .2s",
          background: dragging ? "#0d1117" : "#161b22",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
        <p style={{ color: "#e6edf3", fontSize: 15, fontWeight: 600, margin: "0 0 4px 0" }}>
          {loading ? "Procesando..." : "Arrastrá tu archivo TXT acá"}
        </p>
        <p style={{ color: "#8b949e", fontSize: 13, margin: "0 0 14px 0" }}>
          o usá el botón de abajo para seleccionar
        </p>
        <label style={{
          display: "inline-block", background: "#238636", color: "#fff", padding: "10px 24px",
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "background .15s",
        }}>
          Seleccionar archivo .txt
          <input
            ref={fileRef}
            type="file"
            accept=".txt"
            style={{ display: "none" }}
            onChange={handleInputChange}
          />
        </label>
      </div>
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

  // Carrier assignment with priorities
  const carrierAssignments = [];
  const assigned = new Set();

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

        // Closest to any priority CP
        const aMinDist = Math.min(...prioCps.map((p) => Math.abs(aCp - p)));
        const bMinDist = Math.min(...prioCps.map((p) => Math.abs(bCp - p)));
        if (aMinDist !== bMinDist) return aMinDist - bMinDist;
      }

      return 0;
    });

    const taken = c.limit ? matching.slice(0, c.limit) : matching;
    const overflow = c.limit ? matching.slice(c.limit) : [];
    taken.forEach((s) => assigned.add(s.envio));
    carrierAssignments.push({ carrier: c, shipments: taken, overflow });
  }
  const extra = flex.filter((s) => !assigned.has(s.envio));

  // Generate downloadable TXT files
  const generateTXT = (selectedShipments) => {
    // Each shipment has its raw ZPL label stored in rawLabel
    // Rebuild file with page breaks between labels
    const labels = selectedShipments.map((s) => s.rawLabel).filter(Boolean);
    return labels.join("\n^XA^MCY^XZ\n") + (labels.length ? "\n^XA^MCY^XZ\n" : "");
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
            <CarriersPanel carriers={carriers} setCarriers={setCarriers} />
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
