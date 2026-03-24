import React, { useEffect, useMemo, useRef, useState } from "react";

// ── DESIGN TOKENS ──────────────────────────────────────────────────────────────
const BG        = "#07090d";
const GLASS     = "rgba(11,15,21,0.92)";
const GLASS2    = "rgba(7,9,13,0.85)";
const BORDER    = "rgba(255,255,255,0.07)";
const BORDA     = "rgba(0,255,136,0.18)";
const ACCENT    = "#00ff88";
const RED       = "#e05555";
const YELLOW    = "#e8a73a";
const MONO      = "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace";

const RISK_COLOR: Record<string, string> = {
  LOW:      "#4ade80",
  ELEVATED: YELLOW,
  HIGH:     "#f97316",
  CRITICAL: RED,
  PENDING:  "rgba(255,255,255,0.35)",
};

const CONF_COLOR: Record<string, string> = {
  CONFIRMED: ACCENT,
  LIKELY:    "#86efac",
  CONTESTED: YELLOW,
  UNKNOWN:   "rgba(255,255,255,0.38)",
};

const PIPELINE = ["INPUT", "SENTRIX", "SAGE", "AXION", "BLACK DOG", "SCRIBE"] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── TYPES ──────────────────────────────────────────────────────────────────────
type Classification = "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
type StageName      = "IDLE" | "INPUT" | "SENTRIX" | "SAGE" | "AXION" | "BLACK DOG" | "SCRIBE" | "COMPLETE";
type NodeState      = "STANDBY" | "PROCESSING" | "COMPLETE" | "FAILED";
type RiskLevel      = "PENDING" | "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
type Scope          = "GLOBAL" | "CONFLICT" | "ENERGY" | "CYBER";
type WindowCode     = "1H" | "3H" | "6H" | "12H" | "24H";
type OutputMode     = "THREAD" | "SINGLE_SIGNAL" | "RAPID_FIRE" | "LONGFORM_INTEL" | "BREAKING_ALERT";
type XStatus        = "X not configured" | "X configured" | "X test failed" | "X connected";

type Signal      = { text: string; classification: Classification; label: Classification; confidence: number; kind: string };
type IntelPost   = { domain: string; location: string; signal: string; detail: string; source: string; confidence: Classification };
type SageOutput  = { WHAT: string; WHY: string; MECHANISM: string; CONSTRAINTS: string; CHANGING: string; LOCATION: string; DOMAIN: string };
type RiskOutput  = { level: RiskLevel; reason: string; score: number };
type Candidate   = { headline: string; url: string; summary: string; sourceHost: string; publishedAt: string; scope: Scope; feedName: string; score: number };
type XCreds      = { apiKey: string; apiKeySecret: string; accessToken: string; accessTokenSecret: string };
type CleanedSource = { readableText: string; headline: string; body: string; claims: string[]; sourceHost: string; onlyUrlInput: boolean; extracted: boolean; issue?: string };

type AutoScanResponse = {
  success: boolean;
  mode?: string;
  scope?: Scope;
  window?: WindowCode;
  leadCandidate?: Candidate;
  sourceRecord?: { headline: string; content: string; timestamp: string; sourceType: string; sourceHost: string; sourceUrl: string; summary: string; feedName: string };
  candidates?: Candidate[];
  cleanedSource?: CleanedSource;
  sentrix?: Signal[];
  sage?: SageOutput;
  axion?: IntelPost[];
  blackDog?: RiskOutput;
  escalationScore?: number;
  ready?: boolean;
  blockedReason?: string;
  reason?: string;
  message?: string;
  logs?: string[];
};

const OUTPUT_MODES: { id: OutputMode; short: string; desc: string }[] = [
  { id: "THREAD",         short: "THREAD",   desc: "4–6 posts · multi-domain thread" },
  { id: "SINGLE_SIGNAL",  short: "SINGLE",   desc: "1 post · highest-impact signal" },
  { id: "RAPID_FIRE",     short: "RAPID",    desc: "3–5 posts · ultra-compressed" },
  { id: "LONGFORM_INTEL", short: "LONGFORM", desc: "6–8 posts · full depth analysis" },
  { id: "BREAKING_ALERT", short: "BREAKING", desc: "1–3 posts · breaking alert format" },
];

const MIN_AXION: Record<OutputMode, number> = {
  THREAD: 3, SINGLE_SIGNAL: 1, RAPID_FIRE: 2, LONGFORM_INTEL: 3, BREAKING_ALERT: 1,
};

// ── FORMATTERS ─────────────────────────────────────────────────────────────────
function formatPostForX(p: IntelPost): string {
  return [
    `${p.domain} / ${p.location}`,
    p.signal,
    p.detail,
    `SRC: ${(p.source || "OSINT").toUpperCase()} ${p.confidence}`,
  ].filter(Boolean).join("\n");
}

// ── ICONS ──────────────────────────────────────────────────────────────────────
const ShieldIcon = () => (
  <svg width="11" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M12 1L3 5v6c0 5.25 3.75 10.15 9 11.25C17.25 21.15 21 16.25 21 11V5L12 1z" opacity="0.9"/>
  </svg>
);
const CopyIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

// ── PANEL ──────────────────────────────────────────────────────────────────────
function Panel({ label, right, children, noPad }: { label: string; right?: React.ReactNode; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div style={{ background: GLASS, border: `1px solid ${BORDER}`, backdropFilter: "blur(16px)" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <span className="text-[10px] uppercase tracking-[0.28em]" style={{ color: "rgba(255,255,255,0.42)" }}>{label}</span>
        {right && <div>{right}</div>}
      </div>
      <div className={noPad ? "" : "p-4"}>{children}</div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />;
}

// ── GRID BACKGROUND ────────────────────────────────────────────────────────────
function GridBg() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" style={{
      backgroundImage: "linear-gradient(rgba(0,255,136,0.028) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.028) 1px,transparent 1px)",
      backgroundSize: "32px 32px",
      maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%,black 40%,transparent 100%)",
    }}/>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function RSRScribe() {
  const [input,            setInput]            = useState("");
  const [inputLocked,      setInputLocked]       = useState(false);
  const [activeStage,      setActiveStage]       = useState<StageName>("IDLE");
  const [stageStatuses,    setStageStatuses]     = useState<Record<string,NodeState>>(() => Object.fromEntries(PIPELINE.map((s) => [s,"STANDBY"])));
  const [cleanedSource,    setCleanedSource]     = useState<CleanedSource | null>(null);
  const [sentrix,          setSentrix]           = useState<Signal[] | null>(null);
  const [sage,             setSage]              = useState<SageOutput | null>(null);
  const [axion,            setAxion]             = useState<IntelPost[] | null>(null);
  const [blackDog,         setBlackDog]          = useState<RiskOutput | null>(null);
  const [escalationScore,  setEscalationScore]   = useState<number | null>(null);
  const [visibleCount,     setVisibleCount]      = useState(0);
  const [logs,             setLogs]              = useState<string[]>(["RSR SCRIBE // SYSTEM ONLINE","Awaiting signal input"]);
  const [scope,            setScope]             = useState<Scope>("GLOBAL");
  const [windowCode,       setWindowCode]        = useState<WindowCode>("6H");
  const [outputMode,       setOutputMode]        = useState<OutputMode>("THREAD");
  const [candidates,       setCandidates]        = useState<Candidate[]>([]);
  const [sourceRecord,     setSourceRecord]      = useState<AutoScanResponse["sourceRecord"] | null>(null);
  const [blockedReason,    setBlockedReason]     = useState("");
  const [selectedUrl,      setSelectedUrl]       = useState("");
  const [xCreds,           setXCreds]            = useState<XCreds>({ apiKey:"", apiKeySecret:"", accessToken:"", accessTokenSecret:"" });
  const [xStatus,          setXStatus]           = useState<XStatus>("X not configured");
  const [xMessage,         setXMessage]          = useState("");
  const [posting,          setPosting]           = useState(false);
  const [copiedIdx,        setCopiedIdx]         = useState<number|null>(null);
  const [copiedAll,        setCopiedAll]         = useState(false);
  const logRef   = useRef<HTMLDivElement>(null);
  const scanGen  = useRef(0);

  // ── DERIVED STATE ────────────────────────────────────────────────────────────
  const minAxion   = MIN_AXION[outputMode];
  const goodSigs   = sentrix?.filter((s) => s.text.length >= 35) ?? [];
  const riskColor  = RISK_COLOR[blackDog?.level ?? "PENDING"] ?? "rgba(255,255,255,0.38)";

  const outputHasUrls = useMemo(() => {
    const txt = [
      ...(sentrix?.map((s) => s.text) ?? []),
      ...(axion?.flatMap((p) => [p.domain,p.location,p.signal,p.detail]) ?? []),
      sage?.WHAT ?? "", sage?.WHY ?? "", sage?.MECHANISM ?? "",
    ].join(" ");
    return /https?:\/\//i.test(txt) || /www\./i.test(txt);
  }, [sentrix, axion, sage]);

  const ready = useMemo(() => {
    if (!cleanedSource?.extracted) return false;
    if (goodSigs.length < 3) return false;
    if (!sage) return false;
    if (!axion || axion.length < minAxion) return false;
    if (outputHasUrls) return false;
    if (!blackDog || blackDog.level === "PENDING") return false;
    return true;
  }, [cleanedSource, goodSigs.length, sage, axion, minAxion, outputHasUrls, blackDog]);

  const canPost = ready && xStatus === "X connected" && !!axion?.length && !posting;

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { loadXStatus(); }, []);

  // ── HELPERS ──────────────────────────────────────────────────────────────────
  const pushLog = (line: string) => setLogs((p) => [...p, `${new Date().toLocaleTimeString()} // ${line}`]);

  const resetAll = () => {
    setCleanedSource(null); setSentrix(null); setSage(null); setAxion(null);
    setBlackDog(null); setEscalationScore(null); setVisibleCount(0);
    setCandidates([]); setSourceRecord(null); setBlockedReason(""); setSelectedUrl("");
    setActiveStage("INPUT");
    setStageStatuses(Object.fromEntries(PIPELINE.map((s) => [s,"STANDBY"])));
  };

  const finaliseStages = (target: StageName, ok: boolean) => {
    const idx = PIPELINE.indexOf(target as never);
    const next = Object.fromEntries(PIPELINE.map((s,i) =>
      [s, i < idx ? "COMPLETE" : i === idx ? (ok ? "COMPLETE" : "FAILED") : "STANDBY"]
    )) as Record<string,NodeState>;
    setStageStatuses(next);
    setActiveStage(ok ? "COMPLETE" : target);
  };

  const animatePipeline = (gen: number) => {
    const steps: [string, NodeState, number][] = [
      ["INPUT",     "PROCESSING", 0],
      ["INPUT",     "COMPLETE",   2400],
      ["SENTRIX",   "PROCESSING", 2400],
      ["SENTRIX",   "COMPLETE",   12000],
      ["SAGE",      "PROCESSING", 12000],
      ["SAGE",      "COMPLETE",   19000],
      ["AXION",     "PROCESSING", 19000],
      ["AXION",     "COMPLETE",   25500],
      ["BLACK DOG", "PROCESSING", 25500],
    ];
    for (const [stage, status, delay] of steps) {
      setTimeout(() => {
        if (scanGen.current !== gen) return;
        setStageStatuses((p) => ({ ...p, [stage]: status }));
      }, delay);
    }
  };

  const revealPosts = async (posts: IntelPost[] | null | undefined) => {
    setVisibleCount(0);
    if (!posts?.length) return;
    for (let i = 1; i <= posts.length; i++) { await sleep(220); setVisibleCount(i); }
  };

  const relTime = (iso?: string) => {
    if (!iso) return "--";
    const mins = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`;
  };

  // ── DATA HANDLERS ────────────────────────────────────────────────────────────
  const applyData = async (data: AutoScanResponse) => {
    if (Array.isArray(data.logs) && data.logs.length) setLogs(["RSR SCRIBE // SYSTEM ONLINE", ...data.logs]);
    setCandidates(data.candidates || []);
    if (!data.success) {
      setBlockedReason(data.message || data.reason || "No usable feed items returned");
      finaliseStages("INPUT", false);
      return;
    }
    setSelectedUrl(data.sourceRecord?.sourceUrl || data.leadCandidate?.url || data.candidates?.[0]?.url || "");
    setSourceRecord(data.sourceRecord || null);
    setCleanedSource(data.cleanedSource || null);
    setSentrix(data.sentrix || null);
    setSage(data.sage || null);
    setAxion(data.axion || null);
    setBlackDog(data.blackDog || null);
    setEscalationScore(data.escalationScore ?? null);
    setBlockedReason(data.blockedReason || "");
    finaliseStages("SCRIBE", !data.blockedReason);
    await revealPosts(data.axion);
  };

  const runScan = async (extra: Record<string,unknown> = {}) => {
    if (inputLocked) return;
    resetAll();
    setInputLocked(true);
    setLogs(["RSR SCRIBE // SYSTEM ONLINE", `SCAN INITIALIZED — SCOPE:${scope} WINDOW:${windowCode} MODE:${outputMode}`]);
    const gen = ++scanGen.current;
    animatePipeline(gen);
    try {
      const res  = await fetch("/api/auto-scan", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ scope, window: windowCode, outputMode, ...extra }) });
      const data = await res.json() as AutoScanResponse;
      scanGen.current = gen + 1;
      await applyData(data);
    } catch (err) {
      scanGen.current = gen + 1;
      const msg = err instanceof Error ? err.message : "Scan request failed";
      setBlockedReason(msg);
      pushLog(`[SCRIBE] blocked — ${msg}`);
      finaliseStages("INPUT", false);
    } finally {
      setInputLocked(false);
    }
  };

  const promoteCandidate = (c: Candidate) => { setSelectedUrl(c.url); runScan({ leadUrl: c.url }); };

  // ── X HANDLERS ───────────────────────────────────────────────────────────────
  const loadXStatus = async () => {
    try {
      const d = await (await fetch("/api/x/credentials")).json();
      setXStatus(d?.status || (d?.configured ? "X configured" : "X not configured"));
      setXMessage(d?.configured ? "X credentials saved" : "");
    } catch { setXStatus("X not configured"); }
  };

  const saveXCreds = async () => {
    try {
      const d = await (await fetch("/api/x/credentials", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(xCreds) })).json();
      setXStatus(d?.status || "X configured"); setXMessage(d?.message || ""); pushLog(`[X] ${d?.message || "credentials saved"}`);
    } catch { setXStatus("X not configured"); }
  };

  const testX = async () => {
    try {
      const d = await (await fetch("/api/x/test", { method:"POST" })).json();
      setXStatus(d.status); setXMessage(d.message); pushLog(`[X] ${d.message}`);
    } catch { setXStatus("X test failed"); setXMessage("Connection test failed"); }
  };

  const clearX = async () => {
    try { await fetch("/api/x/credentials", { method:"DELETE" }); } catch {}
    setXCreds({ apiKey:"", apiKeySecret:"", accessToken:"", accessTokenSecret:"" });
    setXStatus("X not configured"); setXMessage("Credentials cleared"); pushLog("[X] credentials cleared");
  };

  const postToX = async () => {
    if (!canPost || !axion?.length) { setXMessage(!ready ? "Deployment blocked — pipeline not ready" : "X connection not verified"); return; }
    setPosting(true);
    try {
      const d = await (await fetch("/api/post", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ preview:false, mode:"THREAD", lines: axion.map(formatPostForX) }) })).json();
      setXMessage(d.message); pushLog(`[X] ${d.message}`);
    } catch { setXMessage("Post failed"); } finally { setPosting(false); }
  };

  const copyPost = (p: IntelPost, i: number) => { navigator.clipboard.writeText(formatPostForX(p)).catch(()=>{}); setCopiedIdx(i); setTimeout(()=>setCopiedIdx(null),1800); };
  const copyAllPosts = () => { if (!axion?.length) return; navigator.clipboard.writeText(axion.map(formatPostForX).join("\n\n──────────\n\n")).catch(()=>{}); setCopiedAll(true); setTimeout(()=>setCopiedAll(false),2000); };

  // ── VALIDATION ───────────────────────────────────────────────────────────────
  const checks = [
    { label: "Source extracted",        ok: !!cleanedSource?.extracted },
    { label: "3+ signals",              ok: goodSigs.length >= 3 },
    { label: "SAGE populated",          ok: !!sage },
    { label: `${minAxion}+ intel posts`,ok: !!axion && axion.length >= minAxion },
    { label: "BLACKDOG evaluated",      ok: !!blackDog && blackDog.level !== "PENDING" },
    { label: "No raw URLs",             ok: !outputHasUrls },
  ];

  const stateLabel = inputLocked ? "SCANNING" : ready ? "READY" : "BLOCKED";
  const stateColor = inputLocked ? ACCENT : ready ? ACCENT : RED;

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG, fontFamily: MONO, minHeight:"100vh", position:"relative", overflow:"hidden", color:"rgba(255,255,255,0.82)" }}>
      <GridBg />

      <div style={{ position:"relative", zIndex:10, maxWidth:1720, margin:"0 auto", padding:"16px 18px" }}>

        {/* ── HEADER ── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${BORDER}`, paddingBottom:12, marginBottom:16 }}>
          <div>
            <div style={{ fontSize:13, letterSpacing:"0.22em", textTransform:"uppercase", color:"rgba(255,255,255,0.88)", fontWeight:500 }}>
              RSR SCRIBE — SIGNAL DEPLOYMENT TERMINAL
            </div>
            <div style={{ fontSize:10, letterSpacing:"0.24em", textTransform:"uppercase", color:"rgba(255,255,255,0.32)", marginTop:4 }}>
              FULL-SPECTRUM INTELLIGENCE ENGINE // BUILD LIVE-5
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:24, fontSize:10, letterSpacing:"0.22em", textTransform:"uppercase" }}>
            {/* BLACKDOG status */}
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", border:`1px solid rgba(255,255,255,0.08)`, background:"rgba(0,0,0,0.3)" }}>
              <ShieldIcon />
              <span style={{ color:"rgba(255,255,255,0.45)" }}>BLACKDOG</span>
              <span style={{ color: riskColor }}>{blackDog?.level ?? "STANDBY"}</span>
            </div>
            <span style={{ color:"rgba(255,255,255,0.30)" }}>MODE // {outputMode.replace("_"," ")}</span>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <Dot color={stateColor} />
              <span style={{ color: stateColor }}>{stateLabel}</span>
            </div>
          </div>
        </div>

        {/* ── 3-ZONE LAYOUT ── */}
        <div style={{ display:"grid", gridTemplateColumns:"260px 1fr 390px", gap:16, alignItems:"start" }}>

          {/* ══ LEFT — SIGNAL CONTROL ══ */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

            {/* Deployment State */}
            <Panel label="Deployment State" right={
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <Dot color={stateColor} />
                <span style={{ fontSize:10, letterSpacing:"0.2em", color: stateColor }}>{stateLabel}</span>
              </div>
            }>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.50)", lineHeight:1.7 }}>
                {inputLocked
                  ? "Intelligence pipeline running..."
                  : blockedReason
                  ? blockedReason
                  : sourceRecord
                  ? "Lead source loaded into system."
                  : "Awaiting signal input or AUTO SCAN."}
              </div>

              {/* BLACKDOG risk bar */}
              {blackDog && blackDog.level !== "PENDING" && (
                <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${BORDER}` }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                    <span style={{ fontSize:9, letterSpacing:"0.24em", textTransform:"uppercase", color:"rgba(255,255,255,0.30)" }}>BLACKDOG RISK</span>
                    <span style={{ fontSize:10, letterSpacing:"0.18em", color: riskColor }}>{blackDog.level}</span>
                  </div>
                  <div style={{ height:2, background:"rgba(255,255,255,0.07)", borderRadius:0 }}>
                    <div style={{ height:"100%", width:`${blackDog.score}%`, background: riskColor, transition:"width 0.6s ease", boxShadow:`0 0 6px ${riskColor}` }}/>
                  </div>
                  <div style={{ marginTop:7, fontSize:10, color:"rgba(255,255,255,0.42)", lineHeight:1.6 }}>{blackDog.reason}</div>
                </div>
              )}
            </Panel>

            {/* Validation */}
            <Panel label="Deployment Checks">
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {checks.map((c) => (
                  <div key={c.label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.52)" }}>{c.label}</span>
                    <span style={{ fontSize:9, letterSpacing:"0.18em", color: c.ok ? ACCENT : RED }}>{c.ok ? "PASS" : "FAIL"}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Lead Source */}
            <Panel label="Lead Source">
              <div style={{ fontSize:10, lineHeight:1.9, color:"rgba(255,255,255,0.48)" }}>
                <div>HOST <span style={{ color: ACCENT }}>{sourceRecord?.sourceHost || "--"}</span></div>
                <div>FEED <span style={{ color:"rgba(255,255,255,0.65)" }}>{sourceRecord?.feedName || "--"}</span></div>
                <div>TIME {sourceRecord?.timestamp || "--"}</div>
                {sourceRecord?.headline && (
                  <div style={{ marginTop:8, color:"rgba(255,255,255,0.60)", fontSize:10, lineHeight:1.7 }}>{sourceRecord.headline}</div>
                )}
              </div>
            </Panel>

            {/* SENTRIX */}
            <Panel label="SENTRIX" right={
              sentrix ? <span style={{ fontSize:10, color: ACCENT }}>{sentrix.length} signals</span> : null
            }>
              <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:340, overflowY:"auto" }}>
                {sentrix?.length ? sentrix.map((sig, i) => (
                  <div key={`${sig.text}-${i}`} style={{ padding:"8px 10px", background:"rgba(0,0,0,0.28)", borderLeft:`2px solid ${CONF_COLOR[sig.classification] ?? BORDER}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                      <span style={{ fontSize:9, letterSpacing:"0.2em", color: CONF_COLOR[sig.classification] }}>{sig.classification}</span>
                      <span style={{ fontSize:9, color:"rgba(255,255,255,0.32)" }}>{sig.confidence}</span>
                    </div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.72)", lineHeight:1.6 }}>{sig.text}</div>
                  </div>
                )) : (
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.32)" }}>{inputLocked ? "Extracting signals..." : "Awaiting scan"}</div>
                )}
              </div>
            </Panel>
          </div>

          {/* ══ CENTER — ANALYSIS DESK ══ */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* Input Terminal */}
            <Panel label="Input Terminal" right={
              <span style={{ fontSize:10, letterSpacing:"0.2em", color: inputLocked ? YELLOW : "rgba(255,255,255,0.32)" }}>
                {inputLocked ? "SCANNING" : "OPEN"}
              </span>
            }>
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={inputLocked}
                  placeholder="Paste URL or signal text — leave empty for AUTO SCAN"
                  style={{ width:"100%", minHeight:76, resize:"none", background:"rgba(0,0,0,0.35)", border:`1px solid ${BORDER}`, padding:"10px 12px", fontSize:12, color:"rgba(255,255,255,0.78)", outline:"none", fontFamily:MONO, boxSizing:"border-box", opacity: inputLocked ? 0.6 : 1 }}
                />

                {/* Mode selector */}
                <div>
                  <div style={{ fontSize:9, letterSpacing:"0.26em", textTransform:"uppercase", color:"rgba(255,255,255,0.30)", marginBottom:8 }}>Output Mode</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {OUTPUT_MODES.map((m) => {
                      const active = outputMode === m.id;
                      return (
                        <button key={m.id} onClick={() => setOutputMode(m.id)} disabled={inputLocked}
                          style={{ padding:"5px 12px", fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase", border:`1px solid ${active ? BORDA : BORDER}`, color: active ? ACCENT : "rgba(255,255,255,0.42)", background: active ? "rgba(0,255,136,0.07)" : "rgba(0,0,0,0.2)", cursor:"pointer", fontFamily:MONO, transition:"all 180ms" }}>
                          {m.short}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:6, fontSize:9, color:"rgba(255,255,255,0.28)" }}>
                    {OUTPUT_MODES.find((m) => m.id === outputMode)?.desc}
                  </div>
                </div>

                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} disabled={inputLocked}
                    style={{ flex:1, background:"rgba(0,0,0,0.35)", border:`1px solid ${BORDER}`, padding:"8px 10px", fontSize:10, letterSpacing:"0.18em", color:"rgba(255,255,255,0.72)", outline:"none", fontFamily:MONO }}>
                    <option value="GLOBAL">GLOBAL</option>
                    <option value="CONFLICT">CONFLICT</option>
                    <option value="ENERGY">ENERGY</option>
                    <option value="CYBER">CYBER</option>
                  </select>
                  <select value={windowCode} onChange={(e) => setWindowCode(e.target.value as WindowCode)} disabled={inputLocked}
                    style={{ flex:1, background:"rgba(0,0,0,0.35)", border:`1px solid ${BORDER}`, padding:"8px 10px", fontSize:10, letterSpacing:"0.18em", color:"rgba(255,255,255,0.72)", outline:"none", fontFamily:MONO }}>
                    {["1H","3H","6H","12H","24H"].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                  <button onClick={() => runScan()} disabled={inputLocked}
                    style={{ padding:"8px 22px", fontSize:10, letterSpacing:"0.24em", textTransform:"uppercase", border:`1px solid ${inputLocked ? "rgba(0,255,136,0.22)" : ACCENT}`, color: inputLocked ? "rgba(0,255,136,0.40)" : ACCENT, background: inputLocked ? "rgba(0,255,136,0.04)" : "rgba(0,255,136,0.09)", cursor: inputLocked ? "not-allowed" : "pointer", fontFamily:MONO, transition:"all 160ms" }}>
                    {inputLocked ? "SCANNING..." : "AUTO SCAN"}
                  </button>
                </div>
              </div>
            </Panel>

            {/* Intelligence Flow */}
            <Panel label="Intelligence Flow">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:8 }}>
                {PIPELINE.map((stage, idx) => {
                  const st   = stageStatuses[stage] ?? "STANDBY";
                  const proc = st === "PROCESSING";
                  const done = st === "COMPLETE";
                  const fail = st === "FAILED";
                  const nc   = fail ? RED : (proc || done) ? ACCENT : "rgba(255,255,255,0.18)";
                  return (
                    <div key={stage} style={{ display:"flex", flexDirection:"column", alignItems:"center", position:"relative" }}>
                      {idx < PIPELINE.length - 1 && (
                        <div style={{ position:"absolute", top:22, left:"50%", width:"100%", height:1, background: done ? ACCENT : "rgba(255,255,255,0.06)", boxShadow: done ? `0 0 4px ${ACCENT}` : "none", transition:"all 400ms ease" }} />
                      )}
                      <div style={{ position:"relative", zIndex:1, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${nc}`, background: proc ? "rgba(0,255,136,0.08)" : "rgba(0,0,0,0.4)", color: nc, fontSize:11, letterSpacing:"0.1em", boxShadow: proc ? `0 0 14px rgba(0,255,136,0.35)` : done ? `0 0 6px rgba(0,255,136,0.12)` : "none", animation: proc ? "pulse 1.2s ease-in-out infinite" : "none", transition:"all 240ms ease" }}>
                        {idx + 1}
                      </div>
                      <div style={{ marginTop:8, fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:"rgba(255,255,255,0.60)", textAlign:"center" }}>{stage}</div>
                      <div style={{ marginTop:3, fontSize:8, letterSpacing:"0.15em", color: proc ? ACCENT : fail ? RED : done ? "rgba(0,255,136,0.55)" : "rgba(255,255,255,0.22)" }}>{st}</div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* SAGE Analysis */}
            <Panel label="SAGE Analysis" right={sage ? <span style={{ fontSize:10, color: ACCENT }}>ACTIVE</span> : null}>
              {sage ? (
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  {/* Top row */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                    {[["DOMAIN", sage.DOMAIN], ["LOCATION", sage.LOCATION], ["ESCALATION", `${blackDog?.level ?? "—"} / ${escalationScore ?? 0}`]].map(([k, v]) => (
                      <div key={k} style={{ padding:"10px 12px", background:GLASS2, borderLeft:`2px solid ${BORDA}` }}>
                        <div style={{ fontSize:9, letterSpacing:"0.24em", textTransform:"uppercase", color: ACCENT, marginBottom:6 }}>{k}</div>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,0.80)" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Analysis grid */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    {[["WHAT", sage.WHAT], ["WHY", sage.WHY], ["MECHANISM", sage.MECHANISM], ["CONSTRAINTS", sage.CONSTRAINTS], ["CHANGING", sage.CHANGING]].map(([k, v]) => (
                      <div key={k} style={{ padding:"10px 12px", background:GLASS2, borderLeft:`1px solid rgba(255,255,255,0.07)` }}>
                        <div style={{ fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:6 }}>{k}</div>
                        <div style={{ fontSize:11, color:"rgba(255,255,255,0.72)", lineHeight:1.65 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.30)" }}>
                  {inputLocked ? "Analysis in progress..." : "Awaiting signal input"}
                </div>
              )}
            </Panel>

            {/* Live Log */}
            <Panel label="System Log" right={<span style={{ fontSize:9, color:"rgba(255,255,255,0.25)" }}>{logs.length} entries</span>}>
              <div ref={logRef} style={{ height:130, overflowY:"auto", fontSize:10, lineHeight:1.8, color:"rgba(255,255,255,0.42)" }}>
                {logs.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
              </div>
            </Panel>
          </div>

          {/* ══ RIGHT — DEPLOYMENT RAIL ══ */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

            {/* X Deployment Draft */}
            <div style={{ background: GLASS, border:`1px solid ${BORDER}`, backdropFilter:"blur(16px)" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${BORDER}` }}>
                <span style={{ fontSize:10, letterSpacing:"0.28em", textTransform:"uppercase", color:"rgba(255,255,255,0.42)" }}>X Deployment Draft</span>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  {axion && axion.length > 0 && (
                    <button onClick={copyAllPosts}
                      style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", border:`1px solid ${copiedAll ? BORDA : "rgba(255,255,255,0.08)"}`, color: copiedAll ? ACCENT : "rgba(255,255,255,0.38)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>
                      {copiedAll ? <CheckIcon/> : <CopyIcon/>}
                      {copiedAll ? "COPIED" : "COPY ALL"}
                    </button>
                  )}
                  <span style={{ fontSize:10, color: ACCENT }}>{axion ? `${visibleCount}/${axion.length}` : "–"}</span>
                </div>
              </div>
              <div style={{ padding:14, display:"flex", flexDirection:"column", gap:10 }}>
                {axion?.length ? axion.slice(0, visibleCount).map((post, i) => (
                  <div key={`${post.signal}-${i}`} style={{ background: GLASS2, border:`1px solid rgba(255,255,255,0.06)`, animation:"fadeUp 240ms ease" }}>
                    {/* Card header */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 12px", borderBottom:`1px solid rgba(255,255,255,0.05)` }}>
                      <span style={{ fontSize:9, color:"rgba(255,255,255,0.30)", letterSpacing:"0.15em" }}>#{i+1}</span>
                      <button onClick={() => copyPost(post, i)}
                        style={{ display:"flex", alignItems:"center", gap:4, color: copiedIdx === i ? ACCENT : "rgba(255,255,255,0.30)", background:"transparent", border:`1px solid ${copiedIdx===i ? BORDA : "rgba(255,255,255,0.07)"}`, padding:"3px 7px", cursor:"pointer", fontFamily:MONO, fontSize:9 }}>
                        {copiedIdx === i ? <CheckIcon/> : <CopyIcon/>}
                      </button>
                    </div>
                    {/* 4-line format */}
                    <div style={{ padding:"10px 12px" }}>
                      {/* LINE 1: DOMAIN / LOCATION */}
                      <div style={{ fontSize:10, letterSpacing:"0.18em", textTransform:"uppercase", color: ACCENT, fontWeight:500, marginBottom:7 }}>
                        {post.domain} / {post.location}
                      </div>
                      {/* LINE 2: SIGNAL */}
                      <div style={{ fontSize:12, color:"rgba(255,255,255,0.86)", lineHeight:1.6, marginBottom:7 }}>
                        {post.signal}
                      </div>
                      {/* LINE 3: DETAIL */}
                      <div style={{ fontSize:10.5, color:"rgba(255,255,255,0.52)", lineHeight:1.6, marginBottom:8 }}>
                        {post.detail}
                      </div>
                      {/* LINE 4: SRC + CONFIDENCE */}
                      <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase" }}>
                        <span style={{ color:"rgba(255,255,255,0.30)" }}>SRC: {(post.source || "OSINT").toUpperCase()}</span>
                        <span style={{ color: CONF_COLOR[post.confidence] ?? "rgba(255,255,255,0.38)" }}>{post.confidence}</span>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding:"20px 12px", fontSize:11, color:"rgba(255,255,255,0.28)", fontStyle:"italic" }}>
                    {inputLocked ? "Composing intelligence posts..." : "No signals collected — run AUTO SCAN"}
                  </div>
                )}
              </div>

              {/* Protected by BLACKDOG label */}
              <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 16px", borderTop:`1px solid rgba(255,255,255,0.05)` }}>
                <ShieldIcon />
                <span style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:"rgba(255,255,255,0.25)" }}>Protected by BLACKDOG</span>
                {blackDog && <span style={{ fontSize:9, color: riskColor, marginLeft:"auto" }}>{blackDog.level}</span>}
              </div>
            </div>

            {/* Signal Candidates */}
            <Panel label="Signal Candidates" right={candidates.length ? <span style={{ fontSize:10, color: ACCENT }}>{candidates.length}</span> : null}>
              <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:200, overflowY:"auto" }}>
                {candidates.length ? candidates.map((c, i) => {
                  const sel = selectedUrl === c.url;
                  return (
                    <button key={`${c.url}-${i}`} onClick={() => promoteCandidate(c)} disabled={inputLocked}
                      style={{ textAlign:"left", padding:"8px 10px", background: sel ? "rgba(0,255,136,0.06)" : "rgba(0,0,0,0.22)", border:`1px solid ${sel ? BORDA : "rgba(255,255,255,0.06)"}`, cursor:"pointer", fontFamily:MONO }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:9, letterSpacing:"0.18em", color: ACCENT }}>{c.feedName}</span>
                        <span style={{ fontSize:9, color:"rgba(255,255,255,0.30)" }}>{relTime(c.publishedAt)}</span>
                      </div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{c.headline}</div>
                    </button>
                  );
                }) : (
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.30)" }}>{inputLocked ? "Loading..." : "No candidates loaded"}</div>
                )}
              </div>
            </Panel>

            {/* X Deployment Control */}
            <Panel label="X Deployment Control" right={<span style={{ fontSize:9, letterSpacing:"0.18em", color: xStatus === "X connected" ? ACCENT : "rgba(255,255,255,0.32)" }}>{xStatus}</span>}>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {([["API KEY","apiKey"],["API KEY SECRET","apiKeySecret"],["ACCESS TOKEN","accessToken"],["ACCESS TOKEN SECRET","accessTokenSecret"]] as [string,keyof XCreds][]).map(([lbl,k]) => (
                    <div key={k}>
                      <div style={{ fontSize:8, letterSpacing:"0.22em", textTransform:"uppercase", color:"rgba(255,255,255,0.32)", marginBottom:4 }}>{lbl}</div>
                      <input type="password" value={xCreds[k]} onChange={(e) => setXCreds((p) => ({ ...p, [k]: e.target.value }))}
                        style={{ width:"100%", background:"rgba(0,0,0,0.35)", border:`1px solid ${BORDER}`, padding:"7px 9px", fontSize:11, color:"rgba(255,255,255,0.78)", outline:"none", fontFamily:MONO, boxSizing:"border-box" }}/>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:4 }}>
                  {[["SAVE", saveXCreds, ACCENT], ["TEST", testX, "rgba(255,255,255,0.65)"], ["CLEAR", clearX, "rgba(255,255,255,0.40)"]].map(([lbl, fn, col]) => (
                    <button key={lbl as string} onClick={fn as ()=>void}
                      style={{ padding:"6px 14px", fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase", border:`1px solid rgba(255,255,255,0.1)`, color: col as string, background:"rgba(0,0,0,0.25)", cursor:"pointer", fontFamily:MONO }}>
                      {lbl as string}
                    </button>
                  ))}
                  <button onClick={postToX} disabled={!canPost}
                    style={{ padding:"6px 14px", fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase", border:`1px solid ${canPost ? BORDA : "rgba(255,255,255,0.08)"}`, color: canPost ? ACCENT : "rgba(255,255,255,0.28)", background: canPost ? "rgba(0,255,136,0.08)" : "rgba(0,0,0,0.2)", cursor: canPost ? "pointer" : "not-allowed", fontFamily:MONO, opacity: canPost ? 1 : 0.6 }}>
                    {posting ? "POSTING..." : "POST TO X"}
                  </button>
                </div>
                {xMessage && <div style={{ fontSize:9, color:"rgba(255,255,255,0.38)", letterSpacing:"0.12em" }}>{xMessage}</div>}
              </div>
            </Panel>

            {/* Scribe Decision */}
            <Panel label="Scribe Decision">
              <div style={{ padding:"12px 14px", background: GLASS2, borderLeft:`2px solid ${stateColor}` }}>
                <div style={{ fontSize:9, letterSpacing:"0.24em", textTransform:"uppercase", color:"rgba(255,255,255,0.32)", marginBottom:8 }}>Terminal Judgement</div>
                <div style={{ fontSize:26, fontWeight:500, letterSpacing:"0.06em", color: stateColor, marginBottom:8 }}>{stateLabel}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.48)", lineHeight:1.7 }}>
                  {ready
                    ? `Full-spectrum analysis complete. ${axion?.length ?? 0} posts ready for deployment.`
                    : blockedReason || "One or more deployment conditions unresolved."}
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { box-shadow:0 0 14px rgba(0,255,136,0.35); }
          50%      { box-shadow:0 0 24px rgba(0,255,136,0.65); }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(6px); }
          to   { opacity:1; transform:translateY(0); }
        }
        select option { background:#0d1117; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,255,136,0.2); }
      `}</style>
    </div>
  );
}
