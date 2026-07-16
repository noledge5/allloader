import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, subscribe, human, pct } from "./api.js";

/* ── theme ─────────────────────────────────────────────────────────────── */
const C = {
  bg: "#0c0f0e", card: "#161a19", line: "rgba(117,119,119,0.18)",
  text: "#e1e3e2", dim: "#757777", sub: "#9b9d9d", head: "#f2f4f2",
  accent: "#97f0ae", green: "#006a36", cyan: "#00caeb", red: "#b94040",
  chip: "#1e2421", track: "#232b27",
};
const serif = "'Noto Serif',serif";
const sans = "'Plus Jakarta Sans',system-ui,sans-serif";

const STATUS_COLOR = {
  downloading: C.accent, queued: C.sub, paused: "#e0ac2c",
  completed: C.accent, failed: C.red, canceled: C.dim,
};
const gradients = [
  "linear-gradient(135deg,#0f3d24,#00505c)", "linear-gradient(135deg,#1c1f4a,#00647a)",
  "linear-gradient(135deg,#3a1c4a,#00505c)", "linear-gradient(135deg,#0f3d24,#245c1c)",
  "linear-gradient(135deg,#232b27,#00505c)",
];
const grad = (seed) => {
  let h = 0; for (const ch of String(seed)) h += ch.charCodeAt(0);
  return gradients[h % gradients.length];
};

/* ── tiny icon set ─────────────────────────────────────────────────────── */
const I = {
  dash: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  library: "M3 3h18v18H3zM8 3v18M16 3v18",
  sources: "M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1",
  planner: "M3 4h18v17H3zM3 9h18M8 2v4M16 2v4",
  plus: "M12 5v14M5 12h14", x: "M18 6L6 18M6 6l12 12",
  play: "M8 5v14l11-7z", pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  search: "M11 3a8 8 0 105 14l4 4M11 3a8 8 0 010 16",
  review: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  check: "M20 6L9 17l-5-5",
  filter: "M3 4h18l-7 8v6l-4 2v-8z",
  spark: "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
};
function Svg({ d, s = 16, c = "currentColor", fill = "none", w = 2, style }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke={fill === "none" ? c : "none"}
      strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {d.split("M").filter(Boolean).map((seg, i) => <path key={i} d={"M" + seg} />)}
    </svg>
  );
}

/* ── data hook ─────────────────────────────────────────────────────────── */
function useCove() {
  const [downloads, setDownloads] = useState([]);
  const [sources, setSources] = useState([]);
  const [batches, setBatches] = useState([]);
  const [schedule, setSchedule] = useState({ row_labels: [], grid: [] });
  const [proposals, setProposals] = useState([]);
  const [ai, setAi] = useState({ configured: false });
  const [loaded, setLoaded] = useState(false);   // first data load done? (avoids empty-state flash)
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const refresh = async () => {
    try {
      const [d, s, b, sc, pr] = await Promise.all([
        api.listDownloads(), api.listSources(), api.listBatches(), api.getSchedule(),
        api.listProposals(),
      ]);
      setDownloads(d); setSources(s); setBatches(b);
      setSchedule(sc || { row_labels: [], grid: [] });
      setProposals(pr || []);
      setLoaded(true);
    } catch {}
  };

  useEffect(() => {
    refresh();
    api.aiStatus().then(setAi).catch(() => {});
    const unsub = subscribe((msg) => {
      if (msg.type === "snapshot") setDownloads(msg.downloads);
      else if (msg.type === "progress") {
        setDownloads((cur) => cur.map((d) => d.id === msg.id
          ? { ...d, downloaded: msg.downloaded ?? d.downloaded, total: msg.total ?? d.total, speed: msg.speed ?? d.speed, status: msg.status || d.status }
          : d));
      } else if (msg.type === "download") {
        setDownloads((cur) => cur.map((d) => d.id === msg.id ? { ...d, status: msg.status } : d));
        if (["completed", "failed", "canceled", "queued"].includes(msg.status)) refresh();
      }
    });
    const poll = setInterval(refresh, 4000);
    return () => { unsub(); clearInterval(poll); };
  }, []);

  return { downloads, sources, batches, schedule, setSchedule, proposals, ai, loaded, toast, flash, refresh };
}

/* ── app ───────────────────────────────────────────────────────────────── */
export default function App() {
  const cove = useCove();
  const [view, setView] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [nasOpen, setNasOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [claudeOpen, setClaudeOpen] = useState(false);

  const { downloads, proposals } = cove;
  const active = downloads.filter((d) => d.status === "downloading");
  const queued = downloads.filter((d) => d.status === "queued");
  const done = downloads.filter((d) => d.status === "completed");

  const nav = [
    { key: "dashboard", label: "Dashboard", d: I.dash },
    { key: "review", label: "Review", d: I.review, badge: proposals.length || null },
    { key: "library", label: "Library", d: I.library },
    { key: "sources", label: "Sources", d: I.sources },
    { key: "planner", label: "Planner", d: I.planner, badge: queued.length || null },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.text, fontFamily: sans, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{ width: 210, background: "#0e1211", borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ height: 70, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(145deg,#0f3d24,#1c5c39)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1px rgba(151,240,174,0.25)" }}>
            <Svg d="M12 3v12M6 11l6 6 6-6M5 21h14" c={C.accent} />
          </div>
          <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 19, color: C.head }}>Cove</div>
        </div>
        <nav style={{ flex: 1, padding: "16px 12px" }}>
          {nav.map((n) => {
            const on = view === n.key;
            return (
              <div key={n.key} onClick={() => setView(n.key)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9, cursor: "pointer", marginBottom: 3, color: on ? C.accent : C.sub, background: on ? "rgba(151,240,174,0.1)" : "transparent", fontWeight: on ? 700 : 500, fontSize: 13.5 }}>
                <Svg d={n.d} s={17} />
                <span>{n.label}</span>
                {n.badge ? <span style={{ marginLeft: "auto", background: "rgba(151,240,174,0.16)", color: C.accent, fontSize: 10.5, fontWeight: 800, padding: "2px 6px", borderRadius: 99 }}>{n.badge}</span> : null}
              </div>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: `1px solid ${C.line}` }}>
          <div style={{ background: C.card, borderRadius: 10, padding: "12px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Svg d="M2 3h20v7H2zM2 14h20v7H2z" c={C.cyan} s={14} />
              <span style={{ fontSize: 11.5, fontWeight: 700 }}>Downloaded</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, marginLeft: "auto" }} />
            </div>
            <div style={{ fontSize: 10.5, color: C.dim }}>{done.length} items · {human(done.reduce((a, d) => a + (d.total || 0), 0))}</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar search={search} setSearch={setSearch} activeCount={active.length} onNew={() => setAddOpen(true)} />
        <div style={{ flex: 1, overflowY: "auto" }}>
          {view === "dashboard" && <Dashboard cove={cove} active={active} queued={queued} done={done} onOpen={setPreview} goLibrary={() => setView("library")} />}
          {view === "review" && <Review cove={cove} />}
          {view === "library" && <Library done={done} search={search} onOpen={setPreview} cove={cove} />}
          {view === "sources" && <Sources cove={cove} goReview={() => setView("review")} />}
          {view === "planner" && <Planner cove={cove} onNewBatch={() => setBatchOpen(true)} />}
        </div>
      </div>

      {/* Claude FAB + panel */}
      <ClaudePanel open={claudeOpen} setOpen={setClaudeOpen} cove={cove} />

      {/* Modals */}
      {addOpen && <AddModal cove={cove} onClose={() => setAddOpen(false)} onPickNas={() => setNasOpen(true)} />}
      {batchOpen && <BatchModal cove={cove} onClose={() => setBatchOpen(false)} />}
      {preview && <Preview item={preview} onClose={() => setPreview(null)} cove={cove} />}
      {cove.toast && <Toast text={cove.toast} />}
    </div>
  );
}

/* ── topbar ────────────────────────────────────────────────────────────── */
function Topbar({ search, setSearch, activeCount, onNew }) {
  return (
    <div style={{ height: 68, flexShrink: 0, display: "flex", alignItems: "center", gap: 16, padding: "0 28px", borderBottom: `1px solid ${C.line}`, background: "rgba(12,15,14,0.7)", backdropFilter: "blur(6px)" }}>
      <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }}><Svg d={I.search} s={15} c={C.dim} /></span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search downloads…"
          style={{ width: "100%", background: C.card, border: `1.5px solid rgba(117,119,119,0.22)`, borderRadius: 8, padding: "10px 14px 10px 36px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.sub, background: C.card, padding: "7px 12px", borderRadius: 99 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, animation: "pulseDot 1.6s ease-in-out infinite" }} />
          {activeCount} active
        </div>
        <button onClick={onNew} style={btn.primary}>
          <Svg d={I.plus} s={14} c="#fff" w={2.4} /> New Download
        </button>
      </div>
    </div>
  );
}

/* ── dashboard ─────────────────────────────────────────────────────────── */
function Dashboard({ cove, active, queued, done, onOpen, goLibrary }) {
  const stats = [
    { label: "Active", value: active.length, color: C.accent },
    { label: "Queued", value: queued.length, color: C.sub },
    { label: "Completed", value: done.length, color: C.cyan },
    { label: "Downloaded", value: human(done.reduce((a, d) => a + (d.total || 0), 0)), color: C.head },
  ];
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return (
    <div style={{ padding: "30px 32px 60px", maxWidth: 1300, animation: "fadeUp .3s ease" }}>
      <h1 style={hStyle}>{greeting}</h1>
      <p style={{ fontSize: 13, color: C.dim, margin: "0 0 26px" }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 32 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: C.card, borderRadius: 8, padding: "18px 20px" }}>
            <div style={label10}>{s.label}</div>
            <div style={{ fontFamily: serif, fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <SectionLabel>Active</SectionLabel>
      {active.length === 0 && <Empty>No active downloads.</Empty>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16, marginBottom: 36 }}>
        {active.map((d) => <ActiveCard key={d.id} d={d} cove={cove} />)}
      </div>

      <SectionLabel>Queued</SectionLabel>
      <div style={{ background: C.card, borderRadius: 8, overflow: "hidden", marginBottom: 36 }}>
        {queued.length === 0 && <div style={{ padding: "22px 18px", fontSize: 12.5, color: C.dim }}>Nothing queued right now.</div>}
        {queued.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderBottom: `1px solid rgba(117,119,119,0.12)` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title || d.filename || d.url}</div>
              <div style={{ fontSize: 11, color: C.dim }}>{d.kind} · {d.quality || ""}</div>
            </div>
            <span style={pill}>Queued</span>
            <IconBtn onClick={() => cove.refresh(api.cancel(d.id))} d={I.x} c={C.red} />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionLabel>Recently finished</SectionLabel>
        <a href="javascript:void(0)" onClick={goLibrary} style={{ fontSize: 12, fontWeight: 700 }}>View library →</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 14 }}>
        {done.slice(0, 6).map((d) => <PosterCard key={d.id} d={d} onOpen={onOpen} small />)}
      </div>
    </div>
  );
}

function ActiveCard({ d, cove }) {
  const known = d.total > 0;                 // HLS/streamhoster downloads often have no total
  const p = pct(d.downloaded, d.total);
  const speed = d.speed ? `${human(d.speed)}/s` : null;
  return (
    <div style={{ background: C.card, borderRadius: 10, overflow: "hidden", border: `1px solid rgba(117,119,119,0.14)` }}>
      <div style={{ height: 90, background: grad(d.id), position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Svg d={d.kind === "file" ? "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" : "M23 7l-7 5 7 5V7zM1 5h15v14H1z"} c="rgba(255,255,255,0.85)" s={26} />
        <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", color: C.accent, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
          {known ? `${Math.round(p)}%` : "läuft"}
        </div>
      </div>
      <div style={{ padding: "13px 15px 15px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{d.title || d.filename || d.url}</div>
        <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 10 }}>
          {known ? `${human(d.downloaded)} / ${human(d.total)}` : `${human(d.downloaded)} geladen`}{speed ? ` · ${speed}` : ""}
        </div>
        {/* Known size → real bar. Unknown (HLS) → indeterminate animated bar so it's clearly alive. */}
        {known
          ? <div style={bar}><div style={{ ...barFill, width: `${p}%` }} /></div>
          : <div style={{ ...bar, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", height: "100%", width: "40%", borderRadius: 99, background: "linear-gradient(90deg,transparent,#97f0ae,transparent)", animation: "indet 1.2s ease-in-out infinite" }} />
            </div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: d.status === "failed" ? C.red : C.sub }}>
            {d.status === "downloading" ? (d.downloaded ? "lädt…" : "startet / löst auf…") : d.status}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <IconBtn onClick={() => api.pause(d.id)} d={I.pause} />
            <IconBtn onClick={() => api.cancel(d.id)} d={I.x} c={C.red} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── library (Cove's own catalog) ──────────────────────────────────────── */
function Library({ done, search, onOpen, cove }) {
  const [lib, setLib] = useState("");     // library-bucket filter
  const [sort, setSort] = useState("new");
  const [pick, setPick] = useState(false); // multiselect mode
  const [sel, setSel] = useState({});

  const buckets = [...new Set(done.map((d) => d.library).filter(Boolean))];
  let items = done.filter((d) =>
    (!search || (d.title || d.filename || "").toLowerCase().includes(search.toLowerCase())) &&
    (!lib || d.library === lib));
  items = [...items].sort((a, b) =>
    sort === "name" ? (a.title || a.filename || "").localeCompare(b.title || b.filename || "")
      : sort === "size" ? (b.total || 0) - (a.total || 0)
        : (b.created_at || 0) - (a.created_at || 0));

  const selIds = items.filter((d) => sel[d.id]).map((d) => d.id);
  const missing = done.filter((d) => d.exists === false).length;
  const removeSelected = async () => {
    for (const id of selIds) await api.remove(id);
    setSel({}); cove.flash(`${selIds.length} gelöscht`); cove.refresh();
  };
  const prune = async () => {
    const r = await api.pruneCatalog();
    cove.flash(`${r.pruned} fehlende Einträge entfernt`); cove.refresh();
  };

  return (
    <div style={{ padding: "30px 32px 60px", maxWidth: 1300, animation: "fadeUp .3s ease" }}>
      <h1 style={hStyle}>Library</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 20px", flexWrap: "wrap" }}>
        <p style={{ fontSize: 13, color: C.dim, margin: 0 }}>
          {items.length} Downloads · Plex/Jellyfin streamt{missing ? ` · ${missing} fehlen auf der NAS` : ""}
        </p>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {missing > 0 && (
            <button onClick={prune} style={{ ...btn.ghost, padding: "9px 14px", fontSize: 12.5, color: "#e0ac2c", borderColor: "rgba(224,172,44,0.4)" }}>
              Fehlende aufräumen ({missing})
            </button>
          )}
          {buckets.length > 0 && (
            <select value={lib} onChange={(e) => setLib(e.target.value)} style={{ ...inp, width: 140 }}>
              <option value="">Alle Libraries</option>
              {buckets.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...inp, width: 140 }}>
            <option value="new">Neueste</option>
            <option value="name">Name</option>
            <option value="size">Größe</option>
          </select>
          <button onClick={() => { setPick(!pick); setSel({}); }} style={{ ...btn.ghost, padding: "9px 14px", fontSize: 12.5 }}>
            {pick ? "Fertig" : "Auswählen"}
          </button>
          {pick && selIds.length > 0 && (
            <button onClick={removeSelected} style={{ ...btn.primary, padding: "9px 14px", background: C.red }}>
              <Svg d={I.trash} s={13} c="#fff" /> Löschen ({selIds.length})
            </button>
          )}
        </div>
      </div>
      {items.length === 0 && <Empty>Noch nichts heruntergeladen.</Empty>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 20 }}>
        {items.map((d) => (
          <div key={d.id} style={{ position: "relative", opacity: d.exists === false ? 0.5 : 1 }}>
            {pick && (
              <input type="checkbox" checked={!!sel[d.id]} onChange={() => setSel((s) => ({ ...s, [d.id]: !s[d.id] }))}
                style={{ position: "absolute", top: 8, right: 8, zIndex: 2, width: 18, height: 18, cursor: "pointer" }} />
            )}
            {d.exists === false && (
              <span style={{ position: "absolute", top: 8, left: 8, zIndex: 2, background: "rgba(224,172,44,0.9)", color: "#000", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 99 }}>fehlt</span>
            )}
            <PosterCard d={d} onOpen={pick ? () => setSel((s) => ({ ...s, [d.id]: !s[d.id] })) : onOpen} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PosterCard({ d, onOpen, small }) {
  const isVideo = (d.kind === "video") || /\.(mp4|mkv|webm|mov|avi)$/i.test(d.filename || "");
  return (
    <div onClick={() => onOpen(d)} style={{ cursor: "pointer" }}>
      <div style={{ aspectRatio: "2/3", borderRadius: 10, background: grad(d.id), position: "relative", overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", marginBottom: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isVideo && <Svg d={I.play} fill="rgba(255,255,255,0.9)" s={30} />}
        <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99 }}>{(d.quality || d.kind || "").toUpperCase()}</div>
      </div>
      <div style={{ fontSize: small ? 12.5 : 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title || d.filename || d.url}</div>
      <div style={{ fontSize: 11, color: C.dim }}>{human(d.total)}</div>
    </div>
  );
}

/* ── review (Triage: confirm Proposals before they download) ───────────── */
const variantLabel = (v) => `${v.language || "?"} · ${(v.host || "direct").toUpperCase()}`;

function Review({ cove }) {
  const proposals = cove.proposals || [];
  const [choice, setChoice] = useState({});   // id -> variant index or -1 (skip)
  const [checked, setChecked] = useState({}); // id -> bool
  const [lang, setLang] = useState("");       // language filter
  const [host, setHost] = useState("");       // streamhoster filter
  const [q, setQ] = useState("");             // series/title filter
  const [sort, setSort] = useState("title");
  const [busy, setBusy] = useState(false);    // confirm/dismiss in flight

  // Reset the per-row choice to the Selector's pre-pick when the set changes.
  useEffect(() => {
    const init = {};
    for (const p of proposals) init[p.id] = p.selected == null ? -1 : p.selected;
    setChoice(init); setChecked({});
  }, [proposals.map((p) => p.id).join(",")]);

  const langs = [...new Set(proposals.flatMap((p) => (p.variants || []).map((v) => v.language).filter(Boolean)))];
  const hosts = [...new Set(proposals.flatMap((p) => (p.variants || []).map((v) => v.host).filter(Boolean)))];

  // Index of the first Variant matching the language+host filter (-1 = none).
  const matchIdx = (p) => (p.variants || []).findIndex(
    (v) => (!lang || v.language === lang) && (!host || v.host === host));

  // The language/host filter also DRIVES the choice: setting it bulk-selects that
  // Variant for every Proposal (skipping ones that don't offer it).
  useEffect(() => {
    if (!lang && !host) return;
    setChoice((c) => {
      const next = { ...c };
      for (const p of proposals) next[p.id] = matchIdx(p);
      return next;
    });
  }, [lang, host]); // eslint-disable-line react-hooks/exhaustive-deps

  let view = proposals.filter((p) => {
    if (q && !(p.title || "").toLowerCase().includes(q.toLowerCase())) return false;
    if ((lang || host) && matchIdx(p) === -1) return false;  // filter actually narrows the list
    return true;
  });
  view = [...view].sort((a, b) => sort === "title"
    ? (a.title || "").localeCompare(b.title || "")
    : (b.title || "").localeCompare(a.title || ""));

  const checkedIds = view.filter((p) => checked[p.id]).map((p) => p.id);
  const acting = checkedIds.length ? checkedIds : view.map((p) => p.id);
  const allChecked = view.length > 0 && view.every((p) => checked[p.id]);

  const setVariant = (id, idx) => setChoice((c) => ({ ...c, [id]: idx }));
  const toggle = (id) => setChecked((c) => ({ ...c, [id]: !c[id] }));
  const toggleAll = () => {
    const next = {}; const v = !allChecked;
    for (const p of view) next[p.id] = v;
    setChecked(next);
  };

  const confirm = async () => {
    if (busy) return;
    const selections = {};
    for (const id of acting) selections[id] = choice[id] === -1 ? null : choice[id];
    setBusy(true);
    try {
      const r = await api.confirmProposals(selections, acting);
      cove.flash(`${r.queued} in die Warteschlange`); await cove.refresh();
    } finally { setBusy(false); }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.dismissProposals(acting);
      cove.flash(`${acting.length} verworfen`); await cove.refresh();
    } finally { setBusy(false); }
  };
  const clearAll = async () => {
    if (busy || !proposals.length) return;
    setBusy(true);
    try {
      await api.dismissProposals(proposals.map((p) => p.id));
      cove.flash("Alle Vorschläge geleert"); await cove.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: "30px 32px 60px", maxWidth: 1200, animation: "fadeUp .3s ease" }}>
      <h1 style={hStyle}>Review</h1>
      <p style={{ fontSize: 13, color: C.dim, margin: "0 0 20px" }}>
        Vorschläge aus deinen Sources — Sprache prüfen, dann herunterladen. Nichts lädt, bis du bestätigst.
      </p>

      {cove.loaded && proposals.length === 0 && <Empty>Keine offenen Vorschläge. Scanne eine Source.</Empty>}

      {proposals.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Serie/Titel filtern…"
              style={{ ...inp, width: 200 }} />
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ ...inp, width: 150 }}>
              <option value="">Alle Sprachen</option>
              {langs.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={host} onChange={(e) => setHost(e.target.value)} style={{ ...inp, width: 140 }}>
              <option value="">Alle Hoster</option>
              {hosts.map((h) => <option key={h} value={h}>{h.toUpperCase()}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...inp, width: 140 }}>
              <option value="title">Titel A–Z</option>
              <option value="title-desc">Titel Z–A</option>
            </select>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={clearAll} disabled={busy} title="Alle Vorschläge löschen (ignoriert Filter)"
                style={{ ...btn.ghost, padding: "9px 12px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }}>
                Alles leeren
              </button>
              <button onClick={dismiss} disabled={busy} style={{ ...btn.ghost, padding: "9px 14px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }}>
                <Svg d={I.trash} s={13} /> Verwerfen ({acting.length})
              </button>
              <button onClick={confirm} disabled={busy} style={{ ...btn.primary, padding: "9px 16px", opacity: busy ? 0.6 : 1 }}>
                <Svg d={I.check} s={14} c="#fff" w={2.4} /> {busy ? "…" : `Herunterladen (${acting.length})`}
              </button>
            </div>
          </div>

          <div style={{ background: C.card, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${C.line}`, fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: ".05em" }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              <span style={{ flex: 1 }}>{view.length} Vorschläge{checkedIds.length ? ` · ${checkedIds.length} markiert` : ""}</span>
              <span style={{ width: 220 }}>Variante (Sprache · Host)</span>
            </div>
            {view.map((p) => {
              const cur = choice[p.id] ?? -1;
              const skip = cur === -1;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: `1px solid rgba(117,119,119,0.1)`, opacity: skip ? 0.55 : 1 }}>
                  <input type="checkbox" checked={!!checked[p.id]} onChange={() => toggle(p.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>
                      {(p.variants || []).length} Varianten · {p.library || "—"}
                      {!skip && p.variants?.[cur] ? ` · ${p.variants[cur].language}` : skip ? " · übersprungen" : ""}
                    </div>
                  </div>
                  <select value={cur} onChange={(e) => setVariant(p.id, parseInt(e.target.value, 10))}
                    style={{ ...inp, width: 220 }}>
                    {(p.variants || []).map((v, j) => <option key={j} value={j}>{variantLabel(v)}</option>)}
                    <option value={-1}>— Überspringen —</option>
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ── sources ───────────────────────────────────────────────────────────── */
const SOURCE_TYPES = [
  { v: "aniworld", label: "Aniworld / Streamhoster" },
  { v: "rss", label: "RSS Feed" },
  { v: "youtube", label: "YouTube Channel" },
  { v: "watchfolder", label: "Watch Folder" },
  { v: "direct", label: "Direct Link" },
];
const LANGUAGES = [
  { v: "German Dub", label: "German Dub (German audio)" },
  { v: "German Sub", label: "German Sub" },
  { v: "English Sub", label: "English Sub" },
  { v: "", label: "Any language" },
];
function Sources({ cove, goReview }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [type, setType] = useState("aniworld");
  const [language, setLanguage] = useState("German Dub");
  const [scanning, setScanning] = useState(null);   // id of the source being scanned
  const add = async () => {
    if (!name.trim()) return;
    // For aniworld, pass the language filter (strict: skip episodes without it).
    const settings = type === "aniworld" ? { language, strict: true } : undefined;
    await api.addSource({ name, type, detail, settings });
    setName(""); setDetail(""); setOpen(false); cove.refresh(); cove.flash("Source added");
  };
  return (
    <div style={{ padding: "30px 32px 60px", maxWidth: 1100, animation: "fadeUp .3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <div>
          <h1 style={hStyle}>Sources</h1>
          <p style={{ fontSize: 13, color: C.dim, margin: 0 }}>Saved origins you re-scan for new items.</p>
        </div>
        <button onClick={() => setOpen(!open)} style={btn.ghost}><Svg d={I.plus} s={14} w={2.4} /> Add Source</button>
      </div>
      {open && (
        <div style={{ background: C.card, border: `1px solid rgba(151,240,174,0.25)`, borderRadius: 10, padding: "18px 20px", marginBottom: 20, display: "grid", gridTemplateColumns: type === "aniworld" ? "1fr 1.2fr 1fr 1fr auto" : "1fr 1.2fr 1fr auto", gap: 12, alignItems: "end" }}>
          <Field label="NAME"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frieren" style={inp} /></Field>
          <Field label="URL OR PATH"><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="https://aniworld.to/… or /volume1/watch" style={inp} /></Field>
          <Field label="TYPE">
            <select value={type} onChange={(e) => setType(e.target.value)} style={inp}>
              {SOURCE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </Field>
          {type === "aniworld" && (
            <Field label="LANGUAGE">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inp}>
                {LANGUAGES.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
              </select>
            </Field>
          )}
          <button onClick={add} style={{ ...btn.primary, whiteSpace: "nowrap" }}>Add</button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cove.loaded && cove.sources.length === 0 && <Empty>No sources yet.</Empty>}
        {cove.sources.map((s) => (
          <div key={s.id} style={{ background: C.card, borderRadius: 10, padding: "16px 18px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(151,240,174,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: C.accent }}><Svg d={I.sources} s={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</span>
                <span style={pill}>{(SOURCE_TYPES.find((t) => t.v === s.type)?.label) || s.type}</span>
              </div>
              <div style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.detail}</div>
            </div>
            <button disabled={scanning} onClick={async () => {
              if (scanning) return;
              setScanning(s.id);
              cove.flash(`Scanne „${s.name}" … das kann bei vielen Episoden ~30s dauern`);
              try {
                const r = await api.scanSource(s.id);
                cove.flash(`${r.proposed} Vorschläge — bitte im Review bestätigen`);
                await cove.refresh(); goReview && goReview();
              } catch (e) { cove.flash("Scan fehlgeschlagen: " + e.message); }
              finally { setScanning(null); }
            }} style={{ ...btn.ghost, padding: "8px 14px", fontSize: 12, opacity: scanning ? 0.6 : 1 }}>
              {scanning === s.id ? "Scanne…" : "Re-scan"}
            </button>
            <IconBtn onClick={async () => { await api.removeSource(s.id); cove.refresh(); }} d={I.trash} c={C.dim} big />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── planner ───────────────────────────────────────────────────────────── */
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
function Planner({ cove, onNewBatch }) {
  const sched = cove.schedule || { row_labels: [], grid: [] };
  const toggle = async (r, c) => {
    const grid = sched.grid.map((row) => row.slice());
    grid[r][c] = !grid[r][c];
    const next = { ...sched, grid };
    cove.setSchedule(next);
    await api.putSchedule({ grid });
  };
  return (
    <div style={{ padding: "30px 32px 60px", maxWidth: 1300, animation: "fadeUp .3s ease" }}>
      <h1 style={hStyle}>Planner</h1>
      <p style={{ fontSize: 13, color: C.dim, margin: "0 0 22px" }}>Batch jobs & off-peak windows.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 22, alignItems: "start" }}>
        <div style={{ background: C.card, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid rgba(117,119,119,0.14)`, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, fontWeight: 700 }}>
            <span>Batch jobs</span>
            <button onClick={onNewBatch} style={{ ...btn.ghost, padding: "6px 12px", fontSize: 11.5 }}>+ New batch</button>
          </div>
          {cove.batches.length === 0 && <div style={{ padding: "22px 18px", fontSize: 12.5, color: C.dim }}>No batch jobs.</div>}
          {cove.batches.map((b) => (
            <div key={b.id} style={{ padding: "14px 18px", borderBottom: `1px solid rgba(117,119,119,0.1)`, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(151,240,174,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: C.accent }}><Svg d={I.planner} s={16} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{b.name}</div>
                <div style={{ fontSize: 11.5, color: C.dim }}>{b.run_at || "unscheduled"}{b.recurring ? " · recurring" : ""}</div>
              </div>
              <span style={pill}>{b.status}</span>
              <IconBtn onClick={async () => { await api.removeBatch(b.id); cove.refresh(); }} d={I.trash} c={C.dim} />
            </div>
          ))}
        </div>
        <div style={{ background: C.card, borderRadius: 10, padding: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 14 }}>Off-peak schedule <span style={{ color: C.dim, fontWeight: 500 }}>— click to toggle</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "44px repeat(7,1fr)", gap: 4, fontSize: 10.5, color: C.dim }}>
            <div />
            {DAYS.map((d, i) => <div key={i} style={{ textAlign: "center", fontWeight: 700 }}>{d}</div>)}
            {(sched.grid || []).map((row, r) => (
              <React.Fragment key={r}>
                <div style={{ alignSelf: "center" }}>{sched.row_labels?.[r]}</div>
                {row.map((on, c) => (
                  <div key={c} onClick={() => toggle(r, c)} style={{ height: 26, borderRadius: 5, cursor: "pointer", background: on ? "rgba(151,240,174,0.35)" : C.track }} />
                ))}
              </React.Fragment>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 11, color: C.dim }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "rgba(151,240,174,0.35)", marginRight: 6 }} />Off-peak window</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: C.track, marginRight: 6 }} />Normal</span>
          </div>
          <p style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>No windows selected = downloads run any time.</p>
        </div>
      </div>
    </div>
  );
}

/* ── add-download modal ────────────────────────────────────────────────── */
function AddModal({ cove, onClose, onPickNas }) {
  const [tab, setTab] = useState("url");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("file");
  const [quality, setQuality] = useState("1080p");
  const [library, setLibrary] = useState("");
  const submit = async () => {
    if (!url.trim()) return;
    await api.createDownload({ url, kind, quality: kind === "video" ? quality : null, library: library || null });
    cove.refresh(); cove.flash("Added to queue"); onClose();
  };
  return (
    <Modal onClose={onClose} width={640} title="New Download">
      <div style={{ display: "flex", gap: 6, padding: "16px 24px 0" }}>
        {[["url", "Paste URL"], ["nl", "Ask Claude"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...tabBtn, ...(tab === k ? tabBtnOn : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "url" ? (
        <div style={{ padding: "20px 24px 26px" }}>
          <Label>PASTE A URL OR VIDEO LINK</Label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ ...inp, marginBottom: 16 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Field label="TYPE">
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={inp}>
                <option value="file">File</option>
                <option value="video">Video</option>
                <option value="audio">Audio (mp3)</option>
              </select>
            </Field>
            {kind === "video" ? (
              <Field label="QUALITY">
                <select value={quality} onChange={(e) => setQuality(e.target.value)} style={inp}>
                  <option value="best">Best available</option>
                  <option value="2160p">4K (2160p)</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                </select>
              </Field>
            ) : (
              <Field label="LIBRARY">
                <input value={library} onChange={(e) => setLibrary(e.target.value)} placeholder="Movies / TV / Files" style={inp} />
              </Field>
            )}
          </div>
          {kind === "video" && (
            <Field label="LIBRARY"><input value={library} onChange={(e) => setLibrary(e.target.value)} placeholder="Movies / TV / Anime" style={{ ...inp, marginBottom: 16 }} /></Field>
          )}
          <button onClick={submit} style={{ ...btn.primary, width: "100%", justifyContent: "center", padding: 12 }}>Add to queue</button>
        </div>
      ) : (
        <IntakeTab cove={cove} onClose={onClose} />
      )}
    </Modal>
  );
}

/* ── natural-language intake (Claude) ──────────────────────────────────── */
function IntakeTab({ cove, onClose }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState(null);   // proposed items awaiting confirm
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!cove.ai.configured) {
    return (
      <div style={{ padding: "20px 24px 30px" }}>
        <div style={{ background: C.bg, border: `1px solid rgba(117,119,119,0.2)`, borderRadius: 10, padding: 16, fontSize: 12.5, color: C.dim, display: "flex", gap: 10, alignItems: "center" }}>
          <Svg d={I.spark} fill={C.accent} s={16} />
          Claude features are off. Set <code style={{ color: C.text }}>ANTHROPIC_API_KEY</code> and restart Cove to enable natural-language intake.
        </div>
      </div>
    );
  }

  const propose = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await api.aiIntake(text);
      setItems(res.items || []); setNote(res.note || "");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.queueItems(items);
      cove.refresh(); cove.flash(`Queued ${r.queued} item${r.queued === 1 ? "" : "s"}`); onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: "20px 24px 26px" }}>
      <Label>TELL CLAUDE WHAT YOU WANT</Label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder='e.g. "grab this playlist as audio, and the aniworld Frieren season 1 in German sub"'
        style={{ ...inp, marginBottom: 12, resize: "vertical", fontFamily: "inherit" }} />
      {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {items === null ? (
        <button onClick={propose} disabled={busy} style={{ ...btn.primary, width: "100%", justifyContent: "center", padding: 12, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Thinking…" : "Ask Claude"}
        </button>
      ) : (
        <>
          {note && <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 10 }}>{note}</div>}
          <div style={{ maxHeight: 220, overflowY: "auto", background: C.bg, borderRadius: 8, border: `1px solid rgba(117,119,119,0.18)`, marginBottom: 12 }}>
            {items.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: C.dim }}>Claude found no downloadable links in that.</div>}
            {items.map((it, i) => (
              <div key={i} style={{ padding: "10px 14px", borderBottom: i < items.length - 1 ? `1px solid rgba(117,119,119,0.12)` : "none" }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title || it.filename || it.url}</div>
                <div style={{ fontSize: 11, color: C.dim }}>{it.kind}{it.library ? ` · ${it.library}` : ""}{it.needs_resolve ? " · needs resolve" : ""}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setItems(null); setNote(""); }} style={{ ...btn.ghost, flex: 1, justifyContent: "center" }}>Back</button>
            <button onClick={confirm} disabled={busy || items.length === 0} style={{ ...btn.primary, flex: 1, justifyContent: "center", opacity: (busy || items.length === 0) ? 0.6 : 1 }}>
              Queue {items.length || ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── batch modal ───────────────────────────────────────────────────────── */
function BatchModal({ cove, onClose }) {
  const [name, setName] = useState("");
  const [runAt, setRunAt] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    await api.addBatch({ name, run_at: runAt || null });
    cove.refresh(); cove.flash("Batch created"); onClose();
  };
  return (
    <Modal onClose={onClose} width={420} title="New batch job">
      <div style={{ padding: 22 }}>
        <Label>NAME</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend TV batch" style={{ ...inp, marginBottom: 14 }} />
        <Label>RUN AT</Label>
        <input value={runAt} onChange={(e) => setRunAt(e.target.value)} placeholder="Sat 02:00" style={{ ...inp, marginBottom: 18 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...btn.ghost, flex: 1, justifyContent: "center" }}>Cancel</button>
          <button onClick={create} style={{ ...btn.primary, flex: 1, justifyContent: "center" }}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── preview (direct-play) ─────────────────────────────────────────────── */
function Preview({ item, onClose, cove }) {
  const isVideo = (item.kind === "video") || /\.(mp4|webm|mov|m4v)$/i.test(item.filename || "");
  return (
    <div onClick={onClose} style={overlay(100)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 860, overflow: "hidden", border: `1px solid rgba(117,119,119,0.15)`, display: "grid", gridTemplateColumns: "1.5fr 1fr" }}>
        <div style={{ background: grad(item.id), minHeight: 340, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {isVideo
            ? <video src={api.fileUrl(item.id)} controls autoPlay style={{ width: "100%", height: "100%", maxHeight: 480, background: "#000" }} />
            : <Svg d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" c="rgba(255,255,255,0.85)" s={54} />}
          <button onClick={onClose} style={{ position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", cursor: "pointer" }}><Svg d={I.x} s={14} /></button>
        </div>
        <div style={{ padding: "24px 22px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{item.kind}</div>
          <div style={{ fontFamily: serif, fontSize: 20, fontWeight: 700, color: C.head, marginBottom: 8 }}>{item.title || item.filename}</div>
          <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 18 }}>{item.quality || ""} · {human(item.total)}</div>
          {!isVideo && <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 18 }}>Direct-play preview supports browser-native video. This file will open in Plex/Jellyfin or download.</div>}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <a href={api.fileUrl(item.id)} download style={{ ...btn.primary, justifyContent: "center", padding: 11 }}>Download file</a>
            <button onClick={async () => { await api.remove(item.id); cove.refresh(); onClose(); }} style={{ padding: 11, borderRadius: 8, border: `1.5px solid rgba(185,64,64,0.35)`, background: "transparent", color: C.red, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Remove from Cove</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── claude panel (conversational control) ─────────────────────────────── */
function ClaudePanel({ open, setOpen, cove }) {
  const configured = cove.ai.configured;
  const [msgs, setMsgs] = useState([]);       // {role:'user'|'assistant', text}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef();

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: "user", text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      // Send prior turns as history (text-only) so Claude has memory.
      const history = msgs.map((m) => ({ role: m.role, content: m.text }));
      const res = await api.aiChat(text, history);
      setMsgs([...next, { role: "assistant", text: res.reply }]);
      if (res.actions && res.actions.length) cove.refresh();
    } catch (e) {
      setMsgs([...next, { role: "assistant", text: "⚠ " + e.message }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60 }} />}
      <div style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 380, maxWidth: "90vw", background: "#0e1211", borderLeft: `1px solid ${C.line}`, zIndex: 61, transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform .25s ease", display: "flex", flexDirection: "column" }}>
        <div style={{ height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#006a36,#00caeb)", display: "flex", alignItems: "center", justifyContent: "center" }}><Svg d={I.spark} fill="#fff" s={15} /></div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.head }}>Download Assistant</div>
            <div style={{ fontSize: 10.5, color: C.dim }}>{configured ? "Powered by Claude" : "Set ANTHROPIC_API_KEY to enable"}</div>
          </div>
          <button onClick={() => setOpen(false)} style={{ marginLeft: "auto", ...iconBtnStyle() }}><Svg d={I.x} s={13} /></button>
        </div>
        <div ref={scroller} style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {msgs.length === 0 && (
            <Bubble who="assistant">
              {configured
                ? "Hi! Ask me things like “what's downloading?”, “pause the big one”, or “retry the failed episodes” and I'll drive the queue for you."
                : "Claude features are off. Set ANTHROPIC_API_KEY and restart Cove, then I can inspect and control your downloads from plain requests."}
            </Bubble>
          )}
          {msgs.map((m, i) => m.role === "user"
            ? <div key={i} style={{ alignSelf: "flex-end", background: "rgba(0,106,54,0.35)", borderRadius: "12px 12px 4px 12px", padding: "10px 14px", fontSize: 12.5, color: C.text, lineHeight: 1.5, maxWidth: "85%" }}>{m.text}</div>
            : <div key={i} style={{ alignSelf: "flex-start", background: C.card, borderRadius: "12px 12px 12px 4px", padding: "10px 14px", fontSize: 12.5, color: C.text, lineHeight: 1.5, maxWidth: "85%", whiteSpace: "pre-wrap" }}>{m.text}</div>
          )}
          {busy && <Bubble who="assistant">…</Bubble>}
        </div>
        <div style={{ padding: 14, borderTop: `1px solid ${C.line}`, display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={!configured || busy} placeholder={configured ? "Ask about your downloads…" : "Claude assistant — not configured"}
            style={{ ...inp, opacity: configured ? 1 : 0.6 }} />
          <button onClick={send} disabled={!configured || busy} style={{ ...btn.primary, opacity: (!configured || busy) ? 0.6 : 1, width: 40, padding: 0, justifyContent: "center" }}><Svg d={I.send} c="#fff" s={15} /></button>
        </div>
      </div>
      <button onClick={() => setOpen(!open)} style={{ position: "fixed", bottom: 26, right: 26, width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#006a36,#00caeb)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 30px rgba(0,106,54,0.4)", zIndex: 55 }}>
        <Svg d={I.spark} fill="#fff" s={24} />
      </button>
    </>
  );
}

/* ── shared bits ───────────────────────────────────────────────────────── */
function Modal({ children, onClose, width, title }) {
  return (
    <div onClick={onClose} style={overlay(80)}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: width, maxHeight: "85vh", overflowY: "auto", border: `1px solid rgba(117,119,119,0.15)` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid rgba(117,119,119,0.15)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: serif, fontSize: 19, fontWeight: 700, color: C.head }}>{title}</div>
          <button onClick={onClose} style={iconBtnStyle()}><Svg d={I.x} s={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
const Field = ({ label, children }) => (<div><div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 6 }}>{label}</div>{children}</div>);
const Label = ({ children }) => <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 8 }}>{children}</div>;
const SectionLabel = ({ children }) => <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 14 }}>{children}</div>;
const Empty = ({ children }) => <div style={{ padding: "40px 0", textAlign: "center", color: C.dim, fontSize: 13 }}>{children}</div>;
const Bubble = ({ children }) => <div style={{ alignSelf: "flex-start", background: C.card, borderRadius: "12px 12px 12px 4px", padding: "10px 14px", fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>{children}</div>;
function IconBtn({ onClick, d, c = C.text, big }) {
  return <button onClick={onClick} style={iconBtnStyle(big)}><Svg d={d} s={big ? 14 : 12} c={c} w={2.2} /></button>;
}
function Toast({ text }) {
  return <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: C.card, border: `1px solid rgba(151,240,174,0.3)`, color: C.text, padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 120, display: "flex", gap: 10, alignItems: "center", animation: "toastIn .25s ease" }}><Svg d="M20 6L9 17l-5-5" c={C.accent} s={15} w={2.4} />{text}</div>;
}

/* ── style tokens ──────────────────────────────────────────────────────── */
const hStyle = { fontFamily: serif, fontSize: 27, fontWeight: 700, color: C.head, margin: "0 0 4px" };
const label10 = { fontSize: 10.5, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
const inp = { width: "100%", background: C.bg, border: `1.5px solid rgba(117,119,119,0.22)`, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none" };
const bar = { height: 5, borderRadius: 99, background: C.track, overflow: "hidden" };
const barFill = { height: "100%", background: "linear-gradient(90deg,#006a36,#97f0ae)", borderRadius: 99, transition: "width .3s ease" };
const pill = { fontSize: 10, fontWeight: 700, color: C.sub, background: C.chip, padding: "2px 8px", borderRadius: 99, textTransform: "uppercase", letterSpacing: ".04em" };
const overlay = (z) => ({ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: z, padding: 20 });
const tabBtn = { padding: "9px 16px", borderRadius: "8px 8px 0 0", border: "none", background: "transparent", color: C.dim, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const tabBtnOn = { background: C.bg, color: C.text };
const iconBtnStyle = (big) => ({ width: big ? 30 : 26, height: big ? 30 : 26, borderRadius: 7, border: "none", background: C.chip, color: C.sub, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 });
const btn = {
  primary: { display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(0,106,54,0.35)", textDecoration: "none" },
  ghost: { display: "flex", alignItems: "center", gap: 7, padding: "10px 16px", borderRadius: 8, border: `1.5px solid rgba(117,119,119,0.28)`, background: "transparent", color: C.text, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
};
