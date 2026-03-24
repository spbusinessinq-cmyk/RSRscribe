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
  PENDING:  "rgba(255,255,255,0.32)",
};

const CONF_COLOR: Record<string, string> = {
  CONFIRMED: ACCENT,
  LIKELY:    "#86efac",
  CONTESTED: YELLOW,
  UNKNOWN:   "rgba(255,255,255,0.35)",
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
type Judgement      = "BLOCKED" | "PARTIAL" | "READY" | "POSTED";

type Signal       = { text: string; classification: Classification; label: Classification; confidence: number; kind: string };
type IntelPost    = { domain: string; location: string; signal: string; detail: string; source: string; confidence: Classification };
type SageOutput   = { WHAT: string; WHY: string; MECHANISM: string; CONSTRAINTS: string; CHANGING: string; LOCATION: string; DOMAIN: string };
type RiskOutput   = { level: RiskLevel; reason: string; score: number };
type Candidate    = { headline: string; url: string; summary: string; sourceHost: string; publishedAt: string; scope: Scope; feedName: string; score: number };
type XCreds       = { apiKey: string; apiKeySecret: string; accessToken: string; accessTokenSecret: string };
type CleanedSource = { readableText: string; headline: string; body: string; claims: string[]; sourceHost: string; onlyUrlInput: boolean; extracted: boolean; issue?: string };

type AutoScanResponse = {
  success: boolean; mode?: string; scope?: Scope; window?: WindowCode;
  leadCandidate?: Candidate;
  sourceRecord?: { headline: string; content: string; timestamp: string; sourceType: string; sourceHost: string; sourceUrl: string; summary: string; feedName: string };
  candidates?: Candidate[]; cleanedSource?: CleanedSource; sentrix?: Signal[]; sage?: SageOutput;
  axion?: IntelPost[]; blackDog?: RiskOutput; escalationScore?: number;
  ready?: boolean; blockedReason?: string; reason?: string; message?: string; logs?: string[];
};

const OUTPUT_MODES: { id: OutputMode; short: string; desc: string }[] = [
  { id: "THREAD",         short: "THREAD",   desc: "4–6 posts · multi-domain thread" },
  { id: "SINGLE_SIGNAL",  short: "SINGLE",   desc: "1 post · highest-impact signal" },
  { id: "RAPID_FIRE",     short: "RAPID",    desc: "3–5 posts · ultra-compressed" },
  { id: "LONGFORM_INTEL", short: "LONGFORM", desc: "6–8 posts · full depth analysis" },
  { id: "BREAKING_ALERT", short: "BREAKING", desc: "1–3 posts · breaking alert format" },
];

const MIN_AXION: Record<OutputMode, number>   = { THREAD:3, SINGLE_SIGNAL:1, RAPID_FIRE:2, LONGFORM_INTEL:3, BREAKING_ALERT:1 };
const MIN_SENTRIX: Record<OutputMode, number> = { THREAD:3, SINGLE_SIGNAL:1, RAPID_FIRE:2, LONGFORM_INTEL:3, BREAKING_ALERT:1 };

// ── FORMATTERS ─────────────────────────────────────────────────────────────────
function formatPostForX(p: IntelPost): string {
  return [`${p.domain} / ${p.location}`, p.signal, p.detail, `SRC: ${(p.source||"OSINT").toUpperCase()} ${p.confidence}`].filter(Boolean).join("\n");
}

// ── ICONS ──────────────────────────────────────────────────────────────────────
const ShieldIcon = () => (
  <svg width="10" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}>
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
const EditIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

// ── PANEL ──────────────────────────────────────────────────────────────────────
function Panel({ label, right, children, noPad }: { label: string; right?: React.ReactNode; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div style={{ background:GLASS, border:`1px solid ${BORDER}`, backdropFilter:"blur(16px)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${BORDER}` }}>
        <span style={{ fontSize:10, letterSpacing:"0.26em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)" }}>{label}</span>
        {right}
      </div>
      <div style={noPad ? {} : { padding:16 }}>{children}</div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:color, boxShadow:`0 0 5px ${color}`, flexShrink:0 }} />;
}

function GridBg() {
  return (
    <div aria-hidden style={{ pointerEvents:"none", position:"absolute", inset:0,
      backgroundImage:"linear-gradient(rgba(0,255,136,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.025) 1px,transparent 1px)",
      backgroundSize:"32px 32px", maskImage:"radial-gradient(ellipse 80% 70% at 50% 40%,black 40%,transparent 100%)" }} />
  );
}

function Btn({ children, onClick, disabled, accent, small }: { children: React.ReactNode; onClick: ()=>void; disabled?: boolean; accent?: boolean; small?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: small ? "4px 10px" : "7px 14px", fontSize:9, letterSpacing:"0.2em", textTransform:"uppercase", fontFamily:MONO,
        border:`1px solid ${accent && !disabled ? BORDA : "rgba(255,255,255,0.10)"}`,
        color: accent && !disabled ? ACCENT : disabled ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.60)",
        background: accent && !disabled ? "rgba(0,255,136,0.07)" : "rgba(0,0,0,0.22)",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 }}>
      {children}
    </button>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function RSRScribe() {
  const [input,           setInput]           = useState("");
  const [inputLocked,     setInputLocked]     = useState(false);
  const [stageStatuses,   setStageStatuses]   = useState<Record<string,NodeState>>(() => Object.fromEntries(PIPELINE.map((s)=>[s,"STANDBY"])));
  const [cleanedSource,   setCleanedSource]   = useState<CleanedSource|null>(null);
  const [sentrix,         setSentrix]         = useState<Signal[]|null>(null);
  const [sage,            setSage]            = useState<SageOutput|null>(null);
  const [axion,           setAxion]           = useState<IntelPost[]|null>(null);
  const [blackDog,        setBlackDog]        = useState<RiskOutput|null>(null);
  const [escalationScore, setEscalationScore] = useState<number|null>(null);
  const [visibleCount,    setVisibleCount]    = useState(0);
  const [logs,            setLogs]            = useState<string[]>(["RSR SCRIBE // SYSTEM ONLINE","Awaiting signal input"]);
  const [scope,           setScope]           = useState<Scope>("GLOBAL");
  const [windowCode,      setWindowCode]      = useState<WindowCode>("6H");
  const [outputMode,      setOutputMode]      = useState<OutputMode>("THREAD");
  const [candidates,      setCandidates]      = useState<Candidate[]>([]);
  const [sourceRecord,    setSourceRecord]    = useState<AutoScanResponse["sourceRecord"]|null>(null);
  const [blockedReason,   setBlockedReason]   = useState("");
  const [selectedUrl,     setSelectedUrl]     = useState("");
  const [xCreds,          setXCreds]          = useState<XCreds>({ apiKey:"", apiKeySecret:"", accessToken:"", accessTokenSecret:"" });
  const [xStatus,         setXStatus]         = useState<XStatus>("X not configured");
  const [xMessage,        setXMessage]        = useState("");
  const [xVerifiedAt,     setXVerifiedAt]     = useState<string|null>(null);
  const [xCredsExpanded,  setXCredsExpanded]  = useState(false);
  const [posting,         setPosting]         = useState(false);
  const [posted,          setPosted]          = useState(false);
  const [postEdits,       setPostEdits]       = useState<Record<number,string>>({});
  const [copiedIdx,       setCopiedIdx]       = useState<number|null>(null);
  const [copiedAll,       setCopiedAll]       = useState(false);
  const logRef  = useRef<HTMLDivElement>(null);
  const scanGen = useRef(0);

  // ── DERIVED ─────────────────────────────────────────────────────────────────
  const minAxion   = MIN_AXION[outputMode];
  const minSentrix = MIN_SENTRIX[outputMode];
  const goodSigs   = sentrix?.filter((s) => s.text.length >= 35) ?? [];
  const riskColor  = RISK_COLOR[blackDog?.level ?? "PENDING"] ?? "rgba(255,255,255,0.32)";

  const outputHasUrls = useMemo(() => {
    const txt = [...(sentrix?.map((s)=>s.text)??[]), ...(axion?.flatMap((p)=>[p.domain,p.location,p.signal,p.detail])??[]), sage?.WHAT??"", sage?.WHY??""].join(" ");
    return /https?:\/\//i.test(txt)||/www\./i.test(txt);
  }, [sentrix, axion, sage]);

  const ready = useMemo(() => {
    if (!cleanedSource?.extracted) return false;
    if (goodSigs.length < minSentrix) return false;
    if (!sage) return false;
    if (!axion || axion.length < minAxion) return false;
    if (outputHasUrls) return false;
    if (!blackDog || blackDog.level === "PENDING") return false;
    return true;
  }, [cleanedSource, goodSigs.length, minSentrix, sage, axion, minAxion, outputHasUrls, blackDog]);

  const judgement: Judgement = posted ? "POSTED" : ready ? "READY" : (axion && axion.length > 0) ? "PARTIAL" : "BLOCKED";

  const deployStatus =
    xStatus !== "X connected" ? "X NOT CONNECTED" :
    posted                    ? "X CONNECTED / POSTED" :
    posting                   ? "X CONNECTED / POSTING" :
    ready                     ? "X CONNECTED / READY TO DEPLOY" :
                                "X CONNECTED / CONTENT BLOCKED";

  const deployStatusColor =
    deployStatus === "X CONNECTED / READY TO DEPLOY" ? ACCENT :
    deployStatus === "X CONNECTED / POSTED"          ? ACCENT :
    deployStatus === "X CONNECTED / POSTING"         ? YELLOW :
    deployStatus === "X NOT CONNECTED"               ? "rgba(255,255,255,0.30)" : RED;

  const deployBlockReason = (): string => {
    if (!axion || axion.length === 0) return "No draft generated — run AUTO SCAN first";
    if (!cleanedSource?.extracted) return "Source extraction failed";
    if (goodSigs.length < minSentrix) return `Signals: ${goodSigs.length}/${minSentrix} required for ${outputMode.replace(/_/g," ")} mode`;
    if (!sage) return "SAGE analysis incomplete";
    if (outputHasUrls) return "Raw URLs detected in output";
    if (!blackDog || blackDog.level === "PENDING") return "BLACKDOG evaluation pending";
    return "";
  };

  const canPost = ready && xStatus === "X connected" && !!axion?.length && !posting && !posted;

  const getEditedText = (i: number): string => postEdits[i] ?? (axion ? formatPostForX(axion[i]) : "");

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { loadXStatus(); }, []);

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  const pushLog = (line: string) => setLogs((p) => [...p, `${new Date().toLocaleTimeString()} // ${line}`]);

  const resetAll = () => {
    setCleanedSource(null); setSentrix(null); setSage(null); setAxion(null);
    setBlackDog(null); setEscalationScore(null); setVisibleCount(0);
    setCandidates([]); setSourceRecord(null); setBlockedReason(""); setSelectedUrl("");
    setPosted(false); setPostEdits({});
    setStageStatuses(Object.fromEntries(PIPELINE.map((s) => [s,"STANDBY"])));
  };

  const finaliseStages = (target: StageName, ok: boolean) => {
    const idx = PIPELINE.indexOf(target as never);
    setStageStatuses(Object.fromEntries(PIPELINE.map((s,i) =>
      [s, i < idx ? "COMPLETE" : i === idx ? (ok ? "COMPLETE" : "FAILED") : "STANDBY"]
    )) as Record<string,NodeState>);
  };

  const animatePipeline = (gen: number) => {
    const steps: [string, NodeState, number][] = [
      ["INPUT","PROCESSING",0],["INPUT","COMPLETE",2400],
      ["SENTRIX","PROCESSING",2400],["SENTRIX","COMPLETE",12000],
      ["SAGE","PROCESSING",12000],["SAGE","COMPLETE",19000],
      ["AXION","PROCESSING",19000],["AXION","COMPLETE",25500],
      ["BLACK DOG","PROCESSING",25500],
    ];
    for (const [stage, status, delay] of steps) {
      setTimeout(() => { if (scanGen.current !== gen) return; setStageStatuses((p) => ({ ...p, [stage]: status })); }, delay);
    }
  };

  const revealPosts = async (posts: IntelPost[]|null|undefined) => {
    setVisibleCount(0);
    if (!posts?.length) return;
    const edits: Record<number,string> = {};
    posts.forEach((p,i) => { edits[i] = formatPostForX(p); });
    setPostEdits(edits);
    for (let i = 1; i <= posts.length; i++) { await sleep(220); setVisibleCount(i); }
  };

  const relTime = (iso?: string) => {
    if (!iso) return "--";
    const mins = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`;
  };

  // ── DATA ────────────────────────────────────────────────────────────────────
  const applyData = async (data: AutoScanResponse) => {
    if (Array.isArray(data.logs) && data.logs.length) setLogs(["RSR SCRIBE // SYSTEM ONLINE", ...data.logs]);
    setCandidates(data.candidates || []);
    if (!data.success) {
      setBlockedReason(data.message || data.reason || "No usable feed items returned");
      finaliseStages("INPUT", false); return;
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
    setLogs(["RSR SCRIBE // SYSTEM ONLINE", `SCAN INITIALIZED — ${scope} ${windowCode} ${outputMode}`]);
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
      setBlockedReason(msg); pushLog(`[SCRIBE] blocked — ${msg}`);
      finaliseStages("INPUT", false);
    } finally { setInputLocked(false); }
  };

  const promoteCandidate = (c: Candidate) => { setSelectedUrl(c.url); runScan({ leadUrl: c.url }); };

  // ── X ───────────────────────────────────────────────────────────────────────
  const loadXStatus = async () => {
    try {
      const d = await (await fetch("/api/x/credentials")).json();
      setXStatus(d?.status || (d?.configured ? "X configured" : "X not configured"));
      if (d?.configured) setXMessage("X credentials saved");
    } catch { setXStatus("X not configured"); }
  };

  const saveXCreds = async () => {
    try {
      const d = await (await fetch("/api/x/credentials", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(xCreds) })).json();
      setXStatus(d?.status || "X configured"); setXMessage(d?.message || "");
      if (d?.status === "X connected") { setXVerifiedAt(new Date().toLocaleTimeString()); setXCredsExpanded(false); }
      pushLog(`[X] ${d?.message || "credentials saved"}`);
    } catch { setXStatus("X not configured"); }
  };

  const testX = async () => {
    try {
      const d = await (await fetch("/api/x/test", { method:"POST" })).json();
      setXStatus(d.status); setXMessage(d.message);
      if (d.status === "X connected") { setXVerifiedAt(new Date().toLocaleTimeString()); setXCredsExpanded(false); }
      pushLog(`[X] ${d.message}`);
    } catch { setXStatus("X test failed"); setXMessage("Connection test failed"); }
  };

  const clearX = async () => {
    try { await fetch("/api/x/credentials", { method:"DELETE" }); } catch {}
    setXCreds({ apiKey:"", apiKeySecret:"", accessToken:"", accessTokenSecret:"" });
    setXStatus("X not configured"); setXMessage(""); setXVerifiedAt(null); setXCredsExpanded(false);
    pushLog("[X] credentials cleared");
  };

  const postToX = async () => {
    if (!canPost || !axion?.length) { setXMessage(!ready ? deployBlockReason() : "X connection not verified"); return; }
    setPosting(true);
    try {
      const lines = axion.map((_,i) => getEditedText(i));
      const d = await (await fetch("/api/post", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ preview:false, mode:"THREAD", lines }) })).json();
      setXMessage(d.message); setPosted(true); pushLog(`[X] ${d.message}`);
    } catch { setXMessage("Post failed — retry"); } finally { setPosting(false); }
  };

  const copyPost = (i: number) => { navigator.clipboard.writeText(getEditedText(i)).catch(()=>{}); setCopiedIdx(i); setTimeout(()=>setCopiedIdx(null),1800); };
  const copyAll  = () => {
    if (!axion?.length) return;
    const text = axion.map((_,i) => getEditedText(i)).join("\n\n──────────\n\n");
    navigator.clipboard.writeText(text).catch(()=>{}); setCopiedAll(true); setTimeout(()=>setCopiedAll(false),2000);
  };

  // ── CHECKS ──────────────────────────────────────────────────────────────────
  const checks = [
    { label:"Source extracted",          ok:!!cleanedSource?.extracted },
    { label:`${minSentrix}+ signals`,    ok:goodSigs.length >= minSentrix },
    { label:"SAGE populated",            ok:!!sage },
    { label:`${minAxion}+ intel posts`,  ok:!!axion && axion.length >= minAxion },
    { label:"BLACKDOG evaluated",        ok:!!blackDog && blackDog.level !== "PENDING" },
    { label:"No raw URLs",               ok:!outputHasUrls },
  ];

  const judgementColor = judgement === "READY" || judgement === "POSTED" ? ACCENT : judgement === "PARTIAL" ? YELLOW : RED;
  const stateLabel = inputLocked ? "SCANNING" : judgement;

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:BG, fontFamily:MONO, minHeight:"100vh", position:"relative", overflow:"hidden", color:"rgba(255,255,255,0.82)" }}>
      <GridBg />
      <div style={{ position:"relative", zIndex:10, maxWidth:1720, margin:"0 auto", padding:"14px 18px" }}>

        {/* HEADER */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${BORDER}`, paddingBottom:12, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:13, letterSpacing:"0.22em", textTransform:"uppercase", color:"rgba(255,255,255,0.88)", fontWeight:500 }}>RSR SCRIBE — SIGNAL DEPLOYMENT TERMINAL</div>
            <div style={{ fontSize:9, letterSpacing:"0.24em", textTransform:"uppercase", color:"rgba(255,255,255,0.28)", marginTop:4 }}>FULL-SPECTRUM INTELLIGENCE ENGINE // BUILD LIVE-11</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:20, fontSize:9, letterSpacing:"0.20em", textTransform:"uppercase" }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 10px", border:`1px solid rgba(255,255,255,0.07)`, background:"rgba(0,0,0,0.28)" }}>
              <ShieldIcon /><span style={{ color:"rgba(255,255,255,0.38)" }}>BLACKDOG</span>
              <span style={{ color: riskColor }}>{blackDog?.level ?? "STANDBY"}</span>
            </div>
            <span style={{ color:"rgba(255,255,255,0.28)" }}>MODE // {outputMode.replace(/_/g," ")}</span>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <Dot color={inputLocked ? YELLOW : judgementColor} />
              <span style={{ color: inputLocked ? YELLOW : judgementColor }}>{stateLabel}</span>
            </div>
          </div>
        </div>

        {/* 3-ZONE GRID */}
        <div style={{ display:"grid", gridTemplateColumns:"256px 1fr 386px", gap:14, alignItems:"start" }}>

          {/* ── LEFT: SIGNAL CONTROL ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

            <Panel label="Deployment State" right={<div style={{ display:"flex", alignItems:"center", gap:6 }}><Dot color={inputLocked ? YELLOW : judgementColor}/><span style={{ fontSize:9, letterSpacing:"0.2em", color: inputLocked ? YELLOW : judgementColor }}>{stateLabel}</span></div>}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.48)", lineHeight:1.75 }}>
                {inputLocked ? "Intelligence pipeline running..." : blockedReason || (sourceRecord ? "Lead source loaded." : "Awaiting signal input or AUTO SCAN.")}
              </div>
              {blackDog && blackDog.level !== "PENDING" && (
                <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${BORDER}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:"rgba(255,255,255,0.28)" }}>BLACKDOG RISK</span>
                    <span style={{ fontSize:9, color: riskColor }}>{blackDog.level}</span>
                  </div>
                  <div style={{ height:2, background:"rgba(255,255,255,0.06)" }}>
                    <div style={{ height:"100%", width:`${blackDog.score}%`, background: riskColor, transition:"width 0.6s ease" }}/>
                  </div>
                  <div style={{ marginTop:7, fontSize:9, color:"rgba(255,255,255,0.38)", lineHeight:1.6 }}>{blackDog.reason}</div>
                </div>
              )}
            </Panel>

            <Panel label="Deployment Checks">
              <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                {checks.map((c) => (
                  <div key={c.label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.48)" }}>{c.label}</span>
                    <span style={{ fontSize:9, letterSpacing:"0.14em", color: c.ok ? ACCENT : RED }}>{c.ok ? "PASS" : "FAIL"}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel label="Lead Source">
              <div style={{ fontSize:10, lineHeight:1.9, color:"rgba(255,255,255,0.44)" }}>
                <div>HOST <span style={{ color: ACCENT }}>{sourceRecord?.sourceHost || "--"}</span></div>
                <div>FEED <span style={{ color:"rgba(255,255,255,0.60)" }}>{sourceRecord?.feedName || "--"}</span></div>
                <div>TIME {sourceRecord?.timestamp || "--"}</div>
                {sourceRecord?.headline && <div style={{ marginTop:6, color:"rgba(255,255,255,0.55)", fontSize:10, lineHeight:1.6 }}>{sourceRecord.headline}</div>}
              </div>
            </Panel>

            <Panel label="SENTRIX" right={sentrix ? <span style={{ fontSize:9, color:ACCENT }}>{sentrix.length} signals</span> : null}>
              <div style={{ display:"flex", flexDirection:"column", gap:7, maxHeight:320, overflowY:"auto" }}>
                {sentrix?.length ? sentrix.map((sig,i) => (
                  <div key={`${sig.text}-${i}`} style={{ padding:"7px 10px", background:"rgba(0,0,0,0.26)", borderLeft:`2px solid ${CONF_COLOR[sig.classification]??BORDER}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:9, letterSpacing:"0.18em", color:CONF_COLOR[sig.classification] }}>{sig.classification}</span>
                      <span style={{ fontSize:9, color:"rgba(255,255,255,0.28)" }}>{sig.confidence}</span>
                    </div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.68)", lineHeight:1.6 }}>{sig.text}</div>
                  </div>
                )) : (
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)" }}>{inputLocked ? "Extracting signals..." : "Awaiting scan"}</div>
                )}
              </div>
            </Panel>
          </div>

          {/* ── CENTER: ANALYSIS DESK ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

            <Panel label="Input Terminal" right={<span style={{ fontSize:9, letterSpacing:"0.2em", color: inputLocked ? YELLOW : "rgba(255,255,255,0.28)" }}>{inputLocked ? "SCANNING" : "OPEN"}</span>}>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <textarea value={input} onChange={(e) => setInput(e.target.value)} disabled={inputLocked}
                  placeholder="Paste URL or signal text — leave empty for AUTO SCAN"
                  style={{ width:"100%", minHeight:70, resize:"none", background:"rgba(0,0,0,0.32)", border:`1px solid ${BORDER}`, padding:"10px 12px", fontSize:12, color:"rgba(255,255,255,0.75)", outline:"none", fontFamily:MONO, boxSizing:"border-box", opacity: inputLocked ? 0.6 : 1 }} />

                {/* Mode selector */}
                <div>
                  <div style={{ fontSize:9, letterSpacing:"0.24em", textTransform:"uppercase", color:"rgba(255,255,255,0.28)", marginBottom:7 }}>Output Mode</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {OUTPUT_MODES.map((m) => {
                      const active = outputMode === m.id;
                      return (
                        <button key={m.id} onClick={() => { setOutputMode(m.id); setPosted(false); }} disabled={inputLocked}
                          style={{ padding:"5px 11px", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", border:`1px solid ${active ? BORDA : BORDER}`, color: active ? ACCENT : "rgba(255,255,255,0.38)", background: active ? "rgba(0,255,136,0.07)" : "rgba(0,0,0,0.18)", cursor:"pointer", fontFamily:MONO }}>
                          {m.short}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:5, fontSize:9, color:"rgba(255,255,255,0.24)" }}>{OUTPUT_MODES.find((m)=>m.id===outputMode)?.desc}</div>
                </div>

                <div style={{ display:"flex", gap:8 }}>
                  <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} disabled={inputLocked}
                    style={{ flex:1, background:"rgba(0,0,0,0.32)", border:`1px solid ${BORDER}`, padding:"7px 10px", fontSize:10, letterSpacing:"0.16em", color:"rgba(255,255,255,0.68)", outline:"none", fontFamily:MONO }}>
                    {["GLOBAL","CONFLICT","ENERGY","CYBER"].map((s)=><option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={windowCode} onChange={(e) => setWindowCode(e.target.value as WindowCode)} disabled={inputLocked}
                    style={{ flex:1, background:"rgba(0,0,0,0.32)", border:`1px solid ${BORDER}`, padding:"7px 10px", fontSize:10, letterSpacing:"0.16em", color:"rgba(255,255,255,0.68)", outline:"none", fontFamily:MONO }}>
                    {["1H","3H","6H","12H","24H"].map((w)=><option key={w} value={w}>{w}</option>)}
                  </select>
                  <button onClick={() => runScan()} disabled={inputLocked}
                    style={{ padding:"7px 20px", fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", border:`1px solid ${inputLocked ? "rgba(0,255,136,0.18)" : ACCENT}`, color: inputLocked ? "rgba(0,255,136,0.38)" : ACCENT, background: inputLocked ? "rgba(0,255,136,0.04)" : "rgba(0,255,136,0.08)", cursor: inputLocked ? "not-allowed" : "pointer", fontFamily:MONO }}>
                    {inputLocked ? "SCANNING..." : "AUTO SCAN"}
                  </button>
                </div>
              </div>
            </Panel>

            {/* Intelligence Flow */}
            <Panel label="Intelligence Flow">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:6 }}>
                {PIPELINE.map((stage,idx) => {
                  const st   = stageStatuses[stage] ?? "STANDBY";
                  const proc = st === "PROCESSING";
                  const done = st === "COMPLETE";
                  const fail = st === "FAILED";
                  const nc   = fail ? RED : (proc||done) ? ACCENT : "rgba(255,255,255,0.15)";
                  return (
                    <div key={stage} style={{ display:"flex", flexDirection:"column", alignItems:"center", position:"relative" }}>
                      {idx < PIPELINE.length-1 && (
                        <div style={{ position:"absolute", top:21, left:"50%", width:"100%", height:1, background: done ? ACCENT : "rgba(255,255,255,0.05)", transition:"all 400ms" }} />
                      )}
                      <div style={{ position:"relative", zIndex:1, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${nc}`, background: proc ? "rgba(0,255,136,0.07)" : "rgba(0,0,0,0.38)", color:nc, fontSize:11, boxShadow: proc ? "0 0 12px rgba(0,255,136,0.30)" : done ? "0 0 5px rgba(0,255,136,0.10)" : "none", animation: proc ? "pulse 1.2s ease-in-out infinite" : "none", transition:"all 230ms" }}>
                        {idx+1}
                      </div>
                      <div style={{ marginTop:7, fontSize:8, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.52)", textAlign:"center" }}>{stage}</div>
                      <div style={{ marginTop:2, fontSize:8, letterSpacing:"0.12em", color: proc ? ACCENT : fail ? RED : done ? "rgba(0,255,136,0.50)" : "rgba(255,255,255,0.18)" }}>{st}</div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* SAGE */}
            <Panel label="SAGE Analysis" right={sage ? <span style={{ fontSize:9, color:ACCENT }}>ACTIVE</span> : null}>
              {sage ? (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                    {[["DOMAIN",sage.DOMAIN],["LOCATION",sage.LOCATION],["ESCALATION",`${blackDog?.level??"—"} / ${escalationScore??0}`]].map(([k,v])=>(
                      <div key={k} style={{ padding:"9px 11px", background:GLASS2, borderLeft:`2px solid ${BORDA}` }}>
                        <div style={{ fontSize:8, letterSpacing:"0.22em", textTransform:"uppercase", color:ACCENT, marginBottom:5 }}>{k}</div>
                        <div style={{ fontSize:10, color:"rgba(255,255,255,0.78)" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[["WHAT",sage.WHAT],["WHY",sage.WHY],["MECHANISM",sage.MECHANISM],["CONSTRAINTS",sage.CONSTRAINTS],["CHANGING",sage.CHANGING]].map(([k,v])=>(
                      <div key={k} style={{ padding:"9px 11px", background:GLASS2, borderLeft:`1px solid rgba(255,255,255,0.06)` }}>
                        <div style={{ fontSize:8, letterSpacing:"0.20em", textTransform:"uppercase", color:"rgba(255,255,255,0.30)", marginBottom:5 }}>{k}</div>
                        <div style={{ fontSize:10, color:"rgba(255,255,255,0.68)", lineHeight:1.65 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)" }}>{inputLocked ? "Analysis in progress..." : "Awaiting signal input"}</div>
              )}
            </Panel>

            {/* System Log */}
            <Panel label="System Log" right={<span style={{ fontSize:9, color:"rgba(255,255,255,0.22)" }}>{logs.length} entries</span>}>
              <div ref={logRef} style={{ height:120, overflowY:"auto", fontSize:10, lineHeight:1.8, color:"rgba(255,255,255,0.38)" }}>
                {logs.map((line,i) => <div key={`${line}-${i}`}>{line}</div>)}
              </div>
            </Panel>
          </div>

          {/* ── RIGHT: DEPLOYMENT RAIL ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

            {/* X DEPLOYMENT DRAFT */}
            <div style={{ background:GLASS, border:`1px solid ${BORDER}`, backdropFilter:"blur(16px)" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${BORDER}` }}>
                <span style={{ fontSize:10, letterSpacing:"0.26em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)" }}>X Deployment Draft</span>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  {axion && axion.length > 0 && (
                    <button onClick={copyAll}
                      style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", border:`1px solid ${copiedAll ? BORDA : "rgba(255,255,255,0.07)"}`, color: copiedAll ? ACCENT : "rgba(255,255,255,0.35)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>
                      {copiedAll ? <CheckIcon/> : <CopyIcon/>}
                      {copiedAll ? "COPIED" : "COPY ALL"}
                    </button>
                  )}
                  <span style={{ fontSize:9, color:ACCENT }}>{axion ? `${visibleCount}/${axion.length}` : "–"}</span>
                </div>
              </div>

              <div style={{ padding:12, display:"flex", flexDirection:"column", gap:10 }}>
                {axion?.length ? axion.slice(0, visibleCount).map((post, i) => (
                  <div key={`${post.signal}-${i}`} style={{ background:GLASS2, border:`1px solid rgba(255,255,255,0.06)`, animation:"fadeUp 240ms ease" }}>
                    {/* Card header */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 12px", borderBottom:`1px solid rgba(255,255,255,0.05)` }}>
                      <span style={{ fontSize:9, color:"rgba(255,255,255,0.28)", letterSpacing:"0.14em" }}>#{i+1}</span>
                      <button onClick={() => copyPost(i)}
                        style={{ display:"flex", alignItems:"center", gap:4, color: copiedIdx===i ? ACCENT : "rgba(255,255,255,0.28)", background:"transparent", border:`1px solid ${copiedIdx===i ? BORDA : "rgba(255,255,255,0.06)"}`, padding:"3px 7px", cursor:"pointer", fontFamily:MONO, fontSize:9 }}>
                        {copiedIdx===i ? <CheckIcon/> : <CopyIcon/>}
                      </button>
                    </div>
                    {/* 4-line display */}
                    <div style={{ padding:"9px 12px" }}>
                      <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", color:ACCENT, fontWeight:500, marginBottom:6 }}>{post.domain} / {post.location}</div>
                      <div style={{ fontSize:12, color:"rgba(255,255,255,0.84)", lineHeight:1.55, marginBottom:6 }}>{post.signal}</div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.50)", lineHeight:1.6, marginBottom:7 }}>{post.detail}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:10, fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:10 }}>
                        <span style={{ color:"rgba(255,255,255,0.28)" }}>SRC: {(post.source||"OSINT").toUpperCase()}</span>
                        <span style={{ color:CONF_COLOR[post.confidence]??"rgba(255,255,255,0.35)" }}>{post.confidence}</span>
                      </div>
                      {/* Inline editable composer */}
                      <div style={{ borderTop:`1px solid rgba(255,255,255,0.06)`, paddingTop:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:5 }}>
                          <EditIcon />
                          <span style={{ fontSize:8, letterSpacing:"0.20em", textTransform:"uppercase", color:"rgba(255,255,255,0.25)" }}>Edit before posting</span>
                        </div>
                        <textarea
                          value={postEdits[i] ?? formatPostForX(post)}
                          onChange={(e) => setPostEdits((p) => ({ ...p, [i]: e.target.value }))}
                          style={{ width:"100%", resize:"vertical", minHeight:80, background:"rgba(0,0,0,0.30)", border:`1px solid rgba(255,255,255,0.08)`, padding:"7px 9px", fontSize:10, color:"rgba(255,255,255,0.72)", outline:"none", fontFamily:MONO, lineHeight:1.65, boxSizing:"border-box" }} />
                        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:5 }}>
                          <span style={{ fontSize:8, color: (postEdits[i]??formatPostForX(post)).length > 280 ? RED : "rgba(255,255,255,0.22)" }}>
                            {(postEdits[i]??formatPostForX(post)).length}/280
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding:"18px 12px", fontSize:11, color:"rgba(255,255,255,0.25)", fontStyle:"italic" }}>
                    {inputLocked ? "Composing intelligence posts..." : "No signals collected — run AUTO SCAN"}
                  </div>
                )}
              </div>

              {/* BLACKDOG footer */}
              <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 16px", borderTop:`1px solid rgba(255,255,255,0.05)` }}>
                <ShieldIcon />
                <span style={{ fontSize:8, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.22)" }}>Protected by BLACKDOG</span>
                {blackDog && <span style={{ fontSize:8, color:riskColor, marginLeft:"auto" }}>{blackDog.level}</span>}
              </div>
            </div>

            {/* Signal Candidates */}
            <Panel label="Signal Candidates" right={candidates.length ? <span style={{ fontSize:9, color:ACCENT }}>{candidates.length}</span> : null}>
              <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:180, overflowY:"auto" }}>
                {candidates.length ? candidates.map((c,i) => {
                  const sel = selectedUrl === c.url;
                  return (
                    <button key={`${c.url}-${i}`} onClick={()=>promoteCandidate(c)} disabled={inputLocked}
                      style={{ textAlign:"left", padding:"7px 10px", background: sel ? "rgba(0,255,136,0.05)" : "rgba(0,0,0,0.20)", border:`1px solid ${sel ? BORDA : "rgba(255,255,255,0.05)"}`, cursor:"pointer", fontFamily:MONO }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                        <span style={{ fontSize:8, letterSpacing:"0.16em", color:ACCENT }}>{c.feedName}</span>
                        <span style={{ fontSize:8, color:"rgba(255,255,255,0.26)" }}>{relTime(c.publishedAt)}</span>
                      </div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.60)", lineHeight:1.5 }}>{c.headline}</div>
                    </button>
                  );
                }) : (
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.26)" }}>{inputLocked ? "Loading..." : "No candidates loaded"}</div>
                )}
              </div>
            </Panel>

            {/* X DEPLOYMENT CONTROL */}
            <div style={{ background:GLASS, border:`1px solid ${BORDER}`, backdropFilter:"blur(16px)" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${BORDER}` }}>
                <span style={{ fontSize:10, letterSpacing:"0.26em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)" }}>X Deployment Control</span>
              </div>

              {/* Deployment status strip */}
              <div style={{ padding:"10px 16px", borderBottom:`1px solid ${BORDER}`, background:"rgba(0,0,0,0.20)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <Dot color={deployStatusColor} />
                  <span style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:deployStatusColor }}>{deployStatus}</span>
                </div>
                {deployStatus === "X CONNECTED / CONTENT BLOCKED" && (
                  <div style={{ marginTop:6, fontSize:9, color:"rgba(255,255,255,0.38)", lineHeight:1.55 }}>{deployBlockReason()}</div>
                )}
                {deployStatus === "X CONNECTED / POSTED" && (
                  <div style={{ marginTop:6, fontSize:9, color:ACCENT }}>Successfully posted to X.</div>
                )}
              </div>

              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                {/* Connected state — collapsed credentials */}
                {xStatus === "X connected" && !xCredsExpanded ? (
                  <div>
                    <div style={{ fontSize:10, letterSpacing:"0.16em", color:ACCENT, marginBottom:4 }}>AUTHENTICATED</div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.40)", lineHeight:1.8 }}>
                      <div>X STATUS: CONNECTED</div>
                      {xVerifiedAt && <div>LAST VERIFIED: {xVerifiedAt}</div>}
                    </div>
                    <button onClick={() => setXCredsExpanded(true)}
                      style={{ marginTop:10, display:"flex", alignItems:"center", gap:5, padding:"4px 10px", fontSize:8, letterSpacing:"0.18em", textTransform:"uppercase", border:`1px solid rgba(255,255,255,0.08)`, color:"rgba(255,255,255,0.42)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>
                      <EditIcon /> EDIT CREDENTIALS
                    </button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      {([["API KEY","apiKey"],["API KEY SECRET","apiKeySecret"],["ACCESS TOKEN","accessToken"],["ACCESS TOKEN SECRET","accessTokenSecret"]] as [string,keyof XCreds][]).map(([lbl,k])=>(
                        <div key={k}>
                          <div style={{ fontSize:8, letterSpacing:"0.20em", textTransform:"uppercase", color:"rgba(255,255,255,0.30)", marginBottom:4 }}>{lbl}</div>
                          <input type="password" value={xCreds[k]} onChange={(e) => setXCreds((p) => ({ ...p, [k]: e.target.value }))}
                            style={{ width:"100%", background:"rgba(0,0,0,0.32)", border:`1px solid ${BORDER}`, padding:"6px 8px", fontSize:11, color:"rgba(255,255,255,0.75)", outline:"none", fontFamily:MONO, boxSizing:"border-box" }} />
                        </div>
                      ))}
                    </div>
                    {xCredsExpanded && (
                      <button onClick={() => setXCredsExpanded(false)} style={{ alignSelf:"flex-start", padding:"3px 8px", fontSize:8, letterSpacing:"0.16em", textTransform:"uppercase", border:`1px solid rgba(255,255,255,0.07)`, color:"rgba(255,255,255,0.35)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>CANCEL</button>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  <Btn onClick={saveXCreds} accent small>SAVE</Btn>
                  <Btn onClick={testX} small>TEST</Btn>
                  <Btn onClick={clearX} small>CLEAR</Btn>
                  <Btn onClick={postToX} disabled={!canPost} accent={canPost} small>
                    {posting ? "POSTING..." : posted ? "POSTED" : "POST TO X"}
                  </Btn>
                </div>
                {xMessage && <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.10em", lineHeight:1.5 }}>{xMessage}</div>}
              </div>
            </div>

            {/* SCRIBE DECISION */}
            <Panel label="Scribe Decision">
              <div style={{ padding:"12px 14px", background:GLASS2, borderLeft:`2px solid ${judgementColor}` }}>
                <div style={{ fontSize:8, letterSpacing:"0.22em", textTransform:"uppercase", color:"rgba(255,255,255,0.28)", marginBottom:6 }}>Terminal Judgement</div>
                <div style={{ fontSize:24, fontWeight:500, letterSpacing:"0.06em", color:judgementColor, marginBottom:12 }}>{judgement}</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, fontSize:9, lineHeight:1.7 }}>
                  {[
                    ["Signals extracted",  `${goodSigs.length} / ${minSentrix} required`],
                    ["Mode requirement",   `${outputMode.replace(/_/g," ")} — ${minAxion}+ posts`],
                    ["Deployment package", ready ? "VALID" : "INVALID"],
                    ["X auth",             xStatus === "X connected" ? "CONNECTED" : "NOT CONNECTED"],
                  ].map(([k,v]) => (
                    <div key={k} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span style={{ color:"rgba(255,255,255,0.38)" }}>{k}</span>
                      <span style={{ color: v === "VALID" || v === "CONNECTED" ? ACCENT : v === "INVALID" || v === "NOT CONNECTED" ? RED : "rgba(255,255,255,0.58)" }}>{v}</span>
                    </div>
                  ))}
                </div>
                {!ready && !posted && deployBlockReason() && (
                  <div style={{ marginTop:10, paddingTop:8, borderTop:`1px solid rgba(255,255,255,0.05)`, fontSize:9, color:"rgba(255,255,255,0.40)", lineHeight:1.6 }}>{deployBlockReason()}</div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{box-shadow:0 0 12px rgba(0,255,136,0.30);} 50%{box-shadow:0 0 22px rgba(0,255,136,0.58);} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(5px);} to{opacity:1;transform:translateY(0);} }
        select option { background:#0d1117; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,255,136,0.18); }
      `}</style>
    </div>
  );
}
