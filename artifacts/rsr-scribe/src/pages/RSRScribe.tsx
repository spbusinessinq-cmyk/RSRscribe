import React, { useEffect, useMemo, useRef, useState } from "react";

// ── DESIGN TOKENS ──────────────────────────────────────────────────────────────
const BG     = "#07090d";
const GLASS  = "rgba(11,15,21,0.94)";
const GLASS2 = "rgba(5,8,13,0.88)";
const BORDER = "rgba(255,255,255,0.07)";
const BORDA  = "rgba(0,255,136,0.14)";
const ACCENT = "#00ff88";
const RED    = "#e05555";
const YELLOW = "#e8a73a";
const MONO   = "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace";
const MAX_CHARS = 280;

const RISK_COLOR: Record<string, string> = {
  LOW: "#4ade80", ELEVATED: YELLOW, HIGH: "#f97316", CRITICAL: RED, PENDING: "rgba(255,255,255,0.28)",
};
const CONF_COLOR: Record<string, string> = {
  CONFIRMED: ACCENT, LIKELY: "#86efac", CONTESTED: YELLOW, UNKNOWN: "rgba(255,255,255,0.32)",
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
type IntelPost    = { domain: string; location: string; signal: string; detail: string; source: string; confidence: Classification; confidenceReason?: string };
type SageOutput   = { WHAT: string; WHY: string; MECHANISM: string; CONSTRAINTS: string; CHANGING: string; LOCATION: string; DOMAIN: string };
type RiskOutput   = { level: RiskLevel; reason: string; score: number };
type Candidate    = { headline: string; url: string; summary: string; sourceHost: string; publishedAt: string; scope: Scope; feedName: string; score: number; clusterSize?: number; clusterUrls?: string[]; clusterFeeds?: string[] };
type XCreds       = { apiKey: string; apiKeySecret: string; accessToken: string; accessTokenSecret: string };
type CleanedSource = { readableText: string; headline: string; body: string; claims: string[]; sourceHost: string; onlyUrlInput: boolean; extracted: boolean; issue?: string };
type SourceRecord  = { headline: string; content: string; timestamp: string; sourceType: string; sourceHost: string; sourceUrl: string; summary: string; feedName: string; clusterSize?: number; clusterFeeds?: string[] };
type AutoScanResponse = {
  success: boolean; mode?: string; scope?: Scope; window?: WindowCode; leadCandidate?: Candidate;
  sourceRecord?: SourceRecord; candidates?: Candidate[]; cleanedSource?: CleanedSource;
  sentrix?: Signal[]; sage?: SageOutput; axion?: IntelPost[]; blackDog?: RiskOutput;
  escalationScore?: number; ready?: boolean; blockedReason?: string; reason?: string; message?: string; logs?: string[];
};

const OUTPUT_MODES: { id: OutputMode; short: string; desc: string }[] = [
  { id: "THREAD",         short: "THREAD",   desc: "4–6 posts · multi-domain thread" },
  { id: "SINGLE_SIGNAL",  short: "SINGLE",   desc: "1 post · highest-impact signal" },
  { id: "RAPID_FIRE",     short: "RAPID",    desc: "3–5 posts · ultra-compressed" },
  { id: "LONGFORM_INTEL", short: "LONGFORM", desc: "6–8 posts · full domain coverage" },
  { id: "BREAKING_ALERT", short: "BREAKING", desc: "1–3 posts · breaking alert format" },
];
const MIN_AXION: Record<OutputMode, number>   = { THREAD:3, SINGLE_SIGNAL:1, RAPID_FIRE:2, LONGFORM_INTEL:3, BREAKING_ALERT:1 };
const MIN_SENTRIX: Record<OutputMode, number> = { THREAD:3, SINGLE_SIGNAL:1, RAPID_FIRE:2, LONGFORM_INTEL:3, BREAKING_ALERT:1 };

// ── AUTO-COMPRESSION ──────────────────────────────────────────────────────────
const COMPRESS_RULES: [RegExp, string][] = [
  [/\bindicates?\s+that\b/gi, "signals"],
  [/\bis\s+likely\s+to\b/gi, "likely to"],
  [/\bin\s+order\s+to\b/gi, "to"],
  [/\baccording\s+to\b/gi, "per"],
  [/\bhas\s+been\b/gi, "is"],
  [/\bsuggests?\s+that\b/gi, "signals"],
  [/\bappears?\s+to\b/gi, "likely"],
  [/\bdemonstrates?\s+that\b/gi, "shows"],
  [/\bit\s+should\s+be\s+noted\s+that\b/gi, ""],
  [/\bdue\s+to\s+the\s+fact\s+that\b/gi, "because"],
  [/\bin\s+the\s+event\s+that\b/gi, "if"],
  [/\bat\s+this\s+point\s+in\s+time\b/gi, "now"],
];
function applyCompression(s: string): string {
  let r = s;
  for (const [rx, rep] of COMPRESS_RULES) r = r.replace(rx, rep);
  return r.replace(/\s{2,}/g, " ").trim();
}
function trimToWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return sp > max * 0.55 ? cut.slice(0, sp) : cut;
}
function compressPost(p: IntelPost): string {
  const line1 = `${p.domain} / ${p.location}`;
  const line2 = applyCompression(p.signal);
  const line3 = applyCompression(p.detail);
  const line4 = `SRC: ${(p.source || "OSINT").toUpperCase()} ${p.confidence}`;
  const full = [line1, line2, line3, line4].join("\n");
  if (full.length <= MAX_CHARS) return full;
  const noDetail = [line1, line2, line4].join("\n");
  if (noDetail.length <= MAX_CHARS) return noDetail;
  const overhead = line1.length + 1 + line4.length + 1;
  return [line1, trimToWord(line2, Math.max(20, MAX_CHARS - overhead)), line4].join("\n");
}

function deriveConfidenceReason(post: IntelPost, clusterSize: number): string {
  if (post.confidenceReason) return post.confidenceReason;
  const multi = clusterSize > 1;
  const cs    = clusterSize;
  switch (post.confidence) {
    case "CONFIRMED":
      return multi
        ? `Multi-source alignment (${cs} feeds); no visible contradiction; event language consistent`
        : "Official source; direct event reporting; corroborating pattern present";
    case "LIKELY":
      return multi
        ? `Partial multi-source corroboration (${cs} feeds); no independent state confirmation; signal consistent with prior pattern`
        : "Single-source report; no independent state confirmation; signal consistent with prior pattern";
    case "CONTESTED":
      return "Conflicting claims present; no independent arbitration; event claims in dispute";
    case "UNKNOWN":
      return "Unverified claim; source credibility unestablished; insufficient corroborating evidence";
    default:
      return "Classification pending";
  }
}

type SignalWeight = "HIGH" | "MEDIUM" | "LOW";
function deriveWeight(post: IntelPost, clusterSize: number, bdScore: number): SignalWeight {
  const confScore = post.confidence === "CONFIRMED" ? 3 : post.confidence === "LIKELY" ? 2 : post.confidence === "CONTESTED" ? 1 : 0;
  const clusterBonus = clusterSize >= 4 ? 2 : clusterSize >= 2 ? 1 : 0;
  const riskBonus = bdScore >= 70 ? 1 : 0;
  const total = confScore + clusterBonus + riskBonus;
  if (total >= 5) return "HIGH";
  if (total >= 3) return "MEDIUM";
  return "LOW";
}
const WEIGHT_COLOR: Record<SignalWeight, string> = { HIGH: RED, MEDIUM: YELLOW, LOW: "rgba(255,255,255,0.28)" };

// ── SAFE FETCH ─────────────────────────────────────────────────────────────────
// Reads the response as text FIRST. If it smells like HTML (proxy/server error
// page) we log the raw content and return a typed { success:false } object so
// the pipeline never crashes with "Unexpected token '<'".
async function safeFetch<T extends Record<string, unknown>>(
  url: string,
  options?: RequestInit
): Promise<T> {
  let text = "";
  try {
    const res = await fetch(url, options);
    text = await res.text();
    const trimmed = text.trimStart();
    if (
      !trimmed ||
      trimmed.startsWith("<") ||
      trimmed.toLowerCase().includes("<!doctype") ||
      trimmed.toLowerCase().startsWith("<html")
    ) {
      console.error("[RSR SCRIBE] SCAN SOURCE FAILED — NON JSON RESPONSE:", text.slice(0, 300));
      return { success: false, reason: "Scan failed — no valid data returned" } as unknown as T;
    }
    return JSON.parse(text) as T;
  } catch (err) {
    const isHtml = text.trimStart().startsWith("<");
    console.error(
      isHtml
        ? "[RSR SCRIBE] SCAN SOURCE FAILED — NON JSON RESPONSE:"
        : "[RSR SCRIBE] JSON parse error:",
      text.slice(0, 300),
      err
    );
    return { success: false, reason: "Scan failed — no valid data returned" } as unknown as T;
  }
}

// ── ICONS ──────────────────────────────────────────────────────────────────────
const ShieldIcon = () => <svg width="9" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}><path d="M12 1L3 5v6c0 5.25 3.75 10.15 9 11.25C17.25 21.15 21 16.25 21 11V5L12 1z" opacity="0.85"/></svg>;
const CopyIcon   = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const CheckIcon  = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const EditIcon   = () => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;

// ── PRIMITIVES ─────────────────────────────────────────────────────────────────
function Dot({ color }: { color: string }) {
  return <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:color, boxShadow:`0 0 4px ${color}`, flexShrink:0 }} />;
}
function GridBg() {
  return <div aria-hidden style={{ pointerEvents:"none", position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(0,255,136,0.016) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.016) 1px,transparent 1px)", backgroundSize:"32px 32px", maskImage:"radial-gradient(ellipse 80% 55% at 50% 30%,black 30%,transparent 100%)" }} />;
}
function PH({ label, right, noBorder }: { label: string; right?: React.ReactNode; noBorder?: boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 12px", borderBottom: noBorder ? "none" : `1px solid ${BORDER}`, flexShrink:0 }}>
      <span style={{ fontSize: 9, letterSpacing:"0.28em", textTransform:"uppercase", color:"rgba(255,255,255,0.32)" }}>{label}</span>
      {right}
    </div>
  );
}
function PanelBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background:GLASS, border:`1px solid ${BORDER}`, backdropFilter:"blur(16px)", ...style }}>{children}</div>;
}
function Btn({ children, onClick, disabled, accent, xs }: { children: React.ReactNode; onClick: ()=>void; disabled?: boolean; accent?: boolean; xs?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: xs ? "3px 8px" : "5px 11px", fontSize: 10, letterSpacing:"0.16em", textTransform:"uppercase", fontFamily:MONO,
        border:`1px solid ${accent && !disabled ? BORDA : "rgba(255,255,255,0.09)"}`,
        color: accent && !disabled ? ACCENT : disabled ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.50)",
        background: accent && !disabled ? "rgba(0,255,136,0.06)" : "rgba(0,0,0,0.20)",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function RSRScribe() {
  const [inputLocked,     setInputLocked]     = useState(false);
  const [stageStatuses,   setStageStatuses]   = useState<Record<string,NodeState>>(() => Object.fromEntries(PIPELINE.map((s)=>[s,"STANDBY"])));
  const [cleanedSource,   setCleanedSource]   = useState<CleanedSource|null>(null);
  const [sentrix,         setSentrix]         = useState<Signal[]|null>(null);
  const [sage,            setSage]            = useState<SageOutput|null>(null);
  const [axion,           setAxion]           = useState<IntelPost[]|null>(null);
  const [blackDog,        setBlackDog]        = useState<RiskOutput|null>(null);
  const [escalationScore, setEscalationScore] = useState<number|null>(null);
  const [visibleCount,    setVisibleCount]    = useState(0);
  const [logs,            setLogs]            = useState<string[]>(["RSR SCRIBE // SYSTEM ONLINE", "Awaiting signal input"]);
  const [scope,           setScope]           = useState<Scope>("GLOBAL");
  const [windowCode,      setWindowCode]      = useState<WindowCode>("6H");
  const [outputMode,      setOutputMode]      = useState<OutputMode>("THREAD");
  const [candidates,      setCandidates]      = useState<Candidate[]>([]);
  const [sourceRecord,    setSourceRecord]    = useState<SourceRecord|null>(null);
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
  const riskColor  = RISK_COLOR[blackDog?.level ?? "PENDING"] ?? "rgba(255,255,255,0.28)";

  const currentClusterSize = useMemo(() => {
    const c = candidates.find((c) => c.url === selectedUrl);
    return c?.clusterSize ?? sourceRecord?.clusterSize ?? 1;
  }, [candidates, selectedUrl, sourceRecord]);

  const outputHasUrls = useMemo(() => {
    const txt = [...(sentrix?.map((s)=>s.text)??[]), ...(axion?.flatMap((p)=>[p.signal,p.detail])??[])].join(" ");
    return /https?:\/\//i.test(txt) || /www\./i.test(txt);
  }, [sentrix, axion]);

  const allPostsValid = useMemo(() =>
    axion?.length ? axion.every((_, i) => (postEdits[i] ?? "").length <= MAX_CHARS) : true
  , [axion, postEdits]);

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
  const judgementColor = judgement === "READY" || judgement === "POSTED" ? ACCENT : judgement === "PARTIAL" ? YELLOW : RED;
  const stateLabel = inputLocked ? "SCANNING" : judgement;

  const deployStatus =
    xStatus !== "X connected" ? "X NOT CONNECTED" :
    posted  ? "X CONNECTED / POSTED"           :
    posting ? "X CONNECTED / POSTING"          :
    ready   ? "X CONNECTED / READY TO DEPLOY"  :
              "X CONNECTED / CONTENT BLOCKED";

  const deployStatusColor =
    deployStatus.includes("READY") || deployStatus.includes("POSTED") ? ACCENT :
    deployStatus.includes("POSTING") ? YELLOW :
    deployStatus === "X NOT CONNECTED" ? "rgba(255,255,255,0.28)" : RED;

  const deployBlockReason = (): string => {
    if (!axion || axion.length === 0) return "No draft generated — run AUTO SCAN first";
    if (!cleanedSource?.extracted)    return "Source extraction failed";
    if (goodSigs.length < minSentrix) return `Signals: ${goodSigs.length}/${minSentrix} required for ${outputMode.replace(/_/g," ")} mode`;
    if (!sage)                        return "SAGE analysis incomplete";
    if (outputHasUrls)                return "Raw URLs detected in output";
    if (!blackDog || blackDog.level === "PENDING") return "BLACKDOG evaluation pending";
    if (!allPostsValid)               return "One or more posts exceed 280 chars";
    return "";
  };

  const canPost = ready && xStatus === "X connected" && !!axion?.length && !posting && !posted && allPostsValid;

  const getEditedText = (i: number) => postEdits[i] ?? "";

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  useEffect(() => { loadXStatus(); }, []);

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  const pushLog = (line: string) => setLogs((p) => [...p, `${new Date().toLocaleTimeString()} // ${line}`]);

  const resetAll = () => {
    setCleanedSource(null); setSentrix(null); setSage(null); setAxion(null);
    setBlackDog(null); setEscalationScore(null); setVisibleCount(0);
    setCandidates([]); setSourceRecord(null); setBlockedReason(""); setSelectedUrl("");
    setPosted(false); setPostEdits({});
    setStageStatuses(Object.fromEntries(PIPELINE.map((s) => [s, "STANDBY"])));
  };

  const finaliseStages = (target: StageName, ok: boolean) => {
    const idx = PIPELINE.indexOf(target as never);
    setStageStatuses(Object.fromEntries(PIPELINE.map((s, i) =>
      [s, i < idx ? "COMPLETE" : i === idx ? (ok ? "COMPLETE" : "FAILED") : "STANDBY"]
    )) as Record<string, NodeState>);
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

  const revealPosts = async (posts: IntelPost[] | null | undefined) => {
    setVisibleCount(0);
    if (!posts?.length) return;
    const edits: Record<number, string> = {};
    posts.forEach((p, i) => { edits[i] = compressPost(p); });
    setPostEdits(edits);
    for (let i = 1; i <= posts.length; i++) { await sleep(180); setVisibleCount(i); }
  };

  const relTime = (iso?: string) => {
    if (!iso) return "--";
    const mins = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
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

  const runScan = async (extra: Record<string, unknown> = {}) => {
    if (inputLocked) return;
    resetAll();
    setInputLocked(true);
    setLogs(["RSR SCRIBE // SYSTEM ONLINE", `SCAN — ${scope} ${windowCode} ${outputMode}`]);
    const gen = ++scanGen.current;
    animatePipeline(gen);
    try {
      const data = await safeFetch<AutoScanResponse>("/api/auto-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, window: windowCode, outputMode, ...extra }) });
      scanGen.current = gen + 1;
      await applyData(data);
    } catch (err) {
      scanGen.current = gen + 1;
      const msg = err instanceof Error ? err.message : "Scan failed";
      setBlockedReason(msg); pushLog(`[SCRIBE] blocked — ${msg}`);
      finaliseStages("INPUT", false);
    } finally { setInputLocked(false); }
  };

  const promoteCandidate = (c: Candidate) => { setSelectedUrl(c.url); runScan({ leadUrl: c.url }); };

  // ── X ───────────────────────────────────────────────────────────────────────
  const loadXStatus = async () => {
    try {
      const d = await safeFetch<Record<string, unknown>>("/api/x/credentials");
      setXStatus((d?.status as string) || (d?.configured ? "X configured" : "X not configured"));
      if (d?.configured) setXMessage("X credentials saved");
    } catch { setXStatus("X not configured"); }
  };

  const saveXCreds = async () => {
    try {
      const d = await safeFetch<Record<string, unknown>>("/api/x/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(xCreds) });
      setXStatus((d?.status as string) || "X configured"); setXMessage((d?.message as string) || "");
      if (d?.status === "X connected") { setXVerifiedAt(new Date().toLocaleTimeString()); setXCredsExpanded(false); }
      pushLog(`[X] ${d?.message || "credentials saved"}`);
    } catch { setXStatus("X not configured"); }
  };

  const testX = async () => {
    try {
      const d = await safeFetch<Record<string, unknown>>("/api/x/test", { method: "POST" });
      setXStatus((d.status as string)); setXMessage((d.message as string));
      if (d.status === "X connected") { setXVerifiedAt(new Date().toLocaleTimeString()); setXCredsExpanded(false); }
      pushLog(`[X] ${d.message}`);
    } catch { setXStatus("X test failed"); setXMessage("Connection test failed"); }
  };

  const clearX = async () => {
    try { await fetch("/api/x/credentials", { method: "DELETE" }); } catch {}
    setXCreds({ apiKey: "", apiKeySecret: "", accessToken: "", accessTokenSecret: "" });
    setXStatus("X not configured"); setXMessage(""); setXVerifiedAt(null); setXCredsExpanded(false);
    pushLog("[X] credentials cleared");
  };

  const postToX = async () => {
    if (!canPost || !axion?.length) { setXMessage(deployBlockReason() || "X not connected"); return; }
    setPosting(true);
    try {
      const lines = axion.map((_, i) => getEditedText(i));
      const d = await safeFetch<Record<string, unknown>>("/api/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview: false, mode: "THREAD", lines }) });
      setXMessage((d.message as string)); setPosted(true); pushLog(`[X] ${d.message}`);
    } catch { setXMessage("Post failed — retry"); } finally { setPosting(false); }
  };

  const copyPost = (i: number) => { navigator.clipboard.writeText(getEditedText(i)).catch(() => {}); setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 1800); };
  const copyAll  = () => {
    if (!axion?.length) return;
    const text = axion.map((_, i) => getEditedText(i)).join("\n\n──\n\n");
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedAll(true); setTimeout(() => setCopiedAll(false), 2000);
  };

  const checks = [
    { label: "Source extracted",        ok: !!cleanedSource?.extracted },
    { label: `${minSentrix}+ signals`,  ok: goodSigs.length >= minSentrix },
    { label: "SAGE populated",          ok: !!sage },
    { label: `${minAxion}+ intel posts`,ok: !!axion && axion.length >= minAxion },
    { label: "BLACKDOG evaluated",      ok: !!blackDog && blackDog.level !== "PENDING" },
    { label: "No raw URLs",             ok: !outputHasUrls },
    { label: "Posts ≤280 chars",        ok: allPostsValid && !!axion?.length },
  ];

  // Source trace — uses selected candidate or sourceRecord
  const traceCandidate = candidates.find((c) => c.url === selectedUrl) || null;

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG, fontFamily: MONO, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative", color: "rgba(255,255,255,0.84)" }}>
      <GridBg />

      {/* HEADER */}
      <div style={{ flexShrink: 0, position: "relative", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 18px", borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div style={{ fontSize: 13, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.88)", fontWeight: 500 }}>RSR SCRIBE — SIGNAL DEPLOYMENT TERMINAL</div>
          <div style={{ fontSize: 9, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(255,255,255,0.24)", marginTop: 2 }}>FULL-SPECTRUM INTELLIGENCE ENGINE // BUILD LIVE-15</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 9px", border: `1px solid rgba(255,255,255,0.06)`, background: "rgba(0,0,0,0.20)" }}>
            <ShieldIcon /><span style={{ color: "rgba(255,255,255,0.30)" }}>BLACKDOG</span>
            <span style={{ color: riskColor }}>{blackDog?.level ?? "STANDBY"}</span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.24)" }}>MODE // {outputMode.replace(/_/g, " ")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Dot color={inputLocked ? YELLOW : judgementColor} />
            <span style={{ color: inputLocked ? YELLOW : judgementColor }}>{stateLabel}</span>
          </div>
        </div>
      </div>

      {/* MAIN 3-COL GRID */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", zIndex: 10, display: "grid", gridTemplateColumns: "260px 1fr 360px", gap: 12, padding: "11px 18px 11px", overflow: "hidden" }}>

        {/* ── LEFT: SIGNAL CONTROL ── */}
        <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Deployment State */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="Deployment State" right={<div style={{ display:"flex", alignItems:"center", gap:5 }}><Dot color={inputLocked ? YELLOW : judgementColor}/><span style={{ fontSize: 9, color: inputLocked ? YELLOW : judgementColor, letterSpacing:"0.12em" }}>{stateLabel}</span></div>} />
            <div style={{ padding: "9px 12px", fontSize: 11, color: "rgba(255,255,255,0.42)", lineHeight: 1.65 }}>
              {inputLocked ? "Intelligence pipeline running..." : blockedReason || (sourceRecord ? "Lead source loaded." : "Awaiting AUTO SCAN.")}
            </div>
          </PanelBox>

          {/* BLACKDOG Risk */}
          {blackDog && blackDog.level !== "PENDING" ? (
            <PanelBox style={{ flexShrink: 0 }}>
              <PH label="BLACKDOG Risk" right={<span style={{ fontSize: 10, color: riskColor, letterSpacing: "0.12em" }}>{blackDog.level}</span>} />
              <div style={{ padding: "8px 12px" }}>
                <div style={{ height: 2, background: "rgba(255,255,255,0.05)", marginBottom: 7 }}>
                  <div style={{ height: "100%", width: `${blackDog.score}%`, background: riskColor, transition: "width 0.6s ease" }} />
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.55 }}>{blackDog.reason}</div>
                {escalationScore !== null && <div style={{ marginTop: 5, fontSize: 9, color: "rgba(255,255,255,0.24)" }}>ESCALATION SCORE: {escalationScore}</div>}
              </div>
            </PanelBox>
          ) : null}

          {/* Deployment Checks */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="Deployment Checks" />
            <div style={{ padding: "6px 12px" }}>
              {checks.map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)" }}>{c.label}</span>
                  <span style={{ fontSize: 9, letterSpacing: "0.12em", color: c.ok ? ACCENT : RED }}>{c.ok ? "PASS" : "FAIL"}</span>
                </div>
              ))}
            </div>
          </PanelBox>

          {/* Lead Source */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="Lead Source" right={sourceRecord?.clusterSize && sourceRecord.clusterSize > 1 ?
              <span style={{ fontSize: 8, letterSpacing: "0.16em", color: YELLOW, border: `1px solid rgba(232,167,58,0.28)`, padding: "2px 5px" }}>CLUSTER {sourceRecord.clusterSize}</span> : null} />
            <div style={{ padding: "8px 12px", fontSize: 10, lineHeight: 1.9, color: "rgba(255,255,255,0.38)" }}>
              <div>HOST <span style={{ color: ACCENT }}>{sourceRecord?.sourceHost || "--"}</span></div>
              <div>FEED <span style={{ color: "rgba(255,255,255,0.55)" }}>{sourceRecord?.feedName || "--"}</span></div>
              <div>TYPE <span style={{ color: "rgba(255,255,255,0.55)" }}>{sourceRecord?.sourceType || "--"}</span></div>
              <div>TIME {sourceRecord?.timestamp ? relTime(sourceRecord.timestamp) : "--"}</div>
              {sourceRecord?.headline && <div style={{ marginTop: 5, color: "rgba(255,255,255,0.50)", fontSize: 10, lineHeight: 1.5 }}>{sourceRecord.headline.slice(0, 90)}</div>}
            </div>
          </PanelBox>

          {/* Source Trace */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="Source Trace" />
            <div style={{ padding: "8px 12px" }}>
              {sourceRecord ? (() => {
                const cs = traceCandidate?.clusterSize ?? sourceRecord.clusterSize ?? 1;
                const clusterStrength = cs >= 4 ? "4+ SOURCE" : cs === 3 ? "3-SOURCE" : cs === 2 ? "2-SOURCE" : "SINGLE";
                const clusterColor   = cs >= 3 ? ACCENT : cs === 2 ? "#86efac" : "rgba(255,255,255,0.26)";
                const feeds = traceCandidate?.clusterFeeds ?? sourceRecord.clusterFeeds ?? [];
                return (
                  <div style={{ fontSize: 10, lineHeight: 1.85, color: "rgba(255,255,255,0.38)" }}>
                    <div style={{ marginBottom: 7, color: "rgba(255,255,255,0.52)", lineHeight: 1.5, fontSize: 10 }}>{sourceRecord.summary?.slice(0, 150) || "No summary available."}</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"3px 8px", marginBottom:6 }}>
                      <div>SRC COUNT <span style={{ color: clusterColor }}>{cs}</span></div>
                      <div>STRENGTH <span style={{ color: clusterColor, letterSpacing:"0.10em" }}>{clusterStrength}</span></div>
                      <div>TYPE <span style={{ color:"rgba(255,255,255,0.50)" }}>{sourceRecord.sourceType || "--"}</span></div>
                      <div>TIME {sourceRecord.timestamp ? relTime(sourceRecord.timestamp) : "--"}</div>
                    </div>
                    <div style={{ marginBottom:4 }}>URL <span style={{ color: "rgba(0,255,136,0.50)", wordBreak:"break-all" }}>{sourceRecord.sourceUrl?.replace(/^https?:\/\//, "").slice(0, 52) || "--"}</span></div>
                    {cs > 1 && feeds.length > 0 && (
                      <div style={{ marginTop: 7, paddingTop: 6, borderTop: `1px solid rgba(255,255,255,0.04)` }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.18em", color: YELLOW, marginBottom: 4 }}>SUPPORTING FEEDS</div>
                        {feeds.slice(0, 4).map((f, i) => (
                          <div key={`${f}-${i}`} style={{ fontSize: 9, color: "rgba(255,255,255,0.30)" }}>· {f}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })() : (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.24)" }}>{inputLocked ? "Fetching source..." : "No source loaded"}</div>
              )}
            </div>
          </PanelBox>

          {/* SENTRIX */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="SENTRIX" right={sentrix ? <span style={{ fontSize: 10, color: ACCENT }}>{sentrix.length} signals</span> : null} />
            <div style={{ padding: "7px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
              {sentrix?.length ? sentrix.map((sig, i) => (
                <div key={`sig-${i}`} style={{ padding: "5px 8px", background: "rgba(0,0,0,0.22)", borderLeft: `2px solid ${CONF_COLOR[sig.classification] ?? BORDER}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 8, letterSpacing: "0.16em", color: CONF_COLOR[sig.classification] }}>{sig.classification}</span>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.22)" }}>{sig.confidence}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>{sig.text}</div>
                </div>
              )) : (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.24)" }}>{inputLocked ? "Classifying signals..." : "Awaiting scan"}</div>
              )}
            </div>
          </PanelBox>
        </div>

        {/* ── CENTER: INTELLIGENCE DESK ── */}
        <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Input Terminal */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="Input Terminal" right={<span style={{ fontSize: 9, color: inputLocked ? YELLOW : "rgba(255,255,255,0.24)" }}>{inputLocked ? "SCANNING" : "OPEN"}</span>} />
            <div style={{ padding: "10px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Output Mode */}
              <div>
                <div style={{ fontSize: 8, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(255,255,255,0.24)", marginBottom: 6 }}>Output Mode</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {OUTPUT_MODES.map((m) => {
                    const active = outputMode === m.id;
                    return (
                      <button key={m.id} onClick={() => { setOutputMode(m.id); setPosted(false); }} disabled={inputLocked}
                        style={{ padding: "4px 10px", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", border: `1px solid ${active ? BORDA : BORDER}`, color: active ? ACCENT : "rgba(255,255,255,0.34)", background: active ? "rgba(0,255,136,0.06)" : "transparent", cursor: "pointer", fontFamily: MONO }}>
                        {m.short}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 4, fontSize: 9, color: "rgba(255,255,255,0.20)" }}>{OUTPUT_MODES.find((m) => m.id === outputMode)?.desc}</div>
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} disabled={inputLocked}
                  style={{ flex: 1, background: "rgba(0,0,0,0.28)", border: `1px solid ${BORDER}`, padding: "6px 8px", fontSize: 10, color: "rgba(255,255,255,0.62)", outline: "none", fontFamily: MONO }}>
                  {["GLOBAL","CONFLICT","ENERGY","CYBER"].map((s) => <option key={s}>{s}</option>)}
                </select>
                <select value={windowCode} onChange={(e) => setWindowCode(e.target.value as WindowCode)} disabled={inputLocked}
                  style={{ flex: 1, background: "rgba(0,0,0,0.28)", border: `1px solid ${BORDER}`, padding: "6px 8px", fontSize: 10, color: "rgba(255,255,255,0.62)", outline: "none", fontFamily: MONO }}>
                  {["1H","3H","6H","12H","24H"].map((w) => <option key={w}>{w}</option>)}
                </select>
                <button onClick={() => runScan()} disabled={inputLocked}
                  style={{ padding: "6px 18px", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", border: `1px solid ${inputLocked ? BORDA : ACCENT}`, color: inputLocked ? "rgba(0,255,136,0.38)" : ACCENT, background: inputLocked ? "rgba(0,255,136,0.04)" : "rgba(0,255,136,0.07)", cursor: inputLocked ? "not-allowed" : "pointer", fontFamily: MONO }}>
                  {inputLocked ? "SCANNING..." : "AUTO SCAN"}
                </button>
              </div>
            </div>
          </PanelBox>

          {/* Intelligence Flow */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="Intelligence Flow" />
            <div style={{ padding: "9px 13px", display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 5 }}>
              {PIPELINE.map((stage, idx) => {
                const st = stageStatuses[stage] ?? "STANDBY";
                const proc = st === "PROCESSING", done = st === "COMPLETE", fail = st === "FAILED";
                const nc = fail ? RED : (proc || done) ? ACCENT : "rgba(255,255,255,0.11)";
                return (
                  <div key={stage} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                    {idx < PIPELINE.length - 1 && <div style={{ position:"absolute", top:19, left:"50%", width:"100%", height:1, background: done ? "rgba(0,255,136,0.24)" : "rgba(255,255,255,0.04)", transition:"all 400ms" }} />}
                    <div style={{ position:"relative", zIndex:1, width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${nc}`, background: proc ? "rgba(0,255,136,0.06)" : "rgba(0,0,0,0.30)", color:nc, fontSize: 11, boxShadow: proc ? "0 0 9px rgba(0,255,136,0.20)" : "none", animation: proc ? "pulse 1.2s ease-in-out infinite" : "none", transition:"all 220ms" }}>
                      {idx + 1}
                    </div>
                    <div style={{ marginTop: 5, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.44)", textAlign: "center" }}>{stage}</div>
                    <div style={{ marginTop: 1, fontSize: 8, color: proc ? ACCENT : fail ? RED : done ? "rgba(0,255,136,0.44)" : "rgba(255,255,255,0.16)" }}>{st}</div>
                  </div>
                );
              })}
            </div>
          </PanelBox>

          {/* X DEPLOYMENT DRAFT — CENTER HERO */}
          <div style={{ background: GLASS, border: `1px solid ${BORDER}`, backdropFilter: "blur(16px)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 13px", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(255,255,255,0.32)" }}>X Deployment Draft</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {axion && axion.length > 0 && (
                  <button onClick={copyAll} style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 7px", fontSize: 9, letterSpacing:"0.12em", textTransform:"uppercase", border:`1px solid ${copiedAll ? BORDA : "rgba(255,255,255,0.06)"}`, color: copiedAll ? ACCENT : "rgba(255,255,255,0.28)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>
                    {copiedAll ? <CheckIcon/> : <CopyIcon/>} {copiedAll ? "COPIED" : "COPY ALL"}
                  </button>
                )}
                <span style={{ fontSize: 10, color: ACCENT }}>{axion ? `${visibleCount}/${axion.length}` : "–"}</span>
              </div>
            </div>

            {/* Cards — natural height, no artificial cap */}
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
              {axion?.length ? axion.slice(0, visibleCount).map((post, i) => {
                const txt = postEdits[i] ?? "";
                const charLen = txt.length;
                const counterColor = charLen > 260 ? RED : charLen > 240 ? YELLOW : "rgba(255,255,255,0.18)";
                const overLimit = charLen > MAX_CHARS;
                const reason = deriveConfidenceReason(post, currentClusterSize);
                const weight = deriveWeight(post, currentClusterSize, blackDog?.score ?? 0);
                return (
                  <div key={`post-${i}`} style={{ background: GLASS2, border: `1px solid ${overLimit ? "rgba(224,85,85,0.20)" : "rgba(255,255,255,0.05)"}`, animation: "fadeUp 200ms ease" }}>
                    {/* Card header */}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 11px", borderBottom:`1px solid rgba(255,255,255,0.04)` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize: 9, color:"rgba(255,255,255,0.22)", letterSpacing:"0.10em" }}>#{i+1}</span>
                        <span style={{ fontSize: 9, letterSpacing:"0.14em", textTransform:"uppercase", color:CONF_COLOR[post.confidence] }}>{post.confidence}</span>
                        {currentClusterSize > 1
                          ? <span style={{ fontSize: 8, color:YELLOW, border:`1px solid rgba(232,167,58,0.25)`, padding:"1px 4px", letterSpacing:"0.12em" }}>CLUSTER {currentClusterSize}</span>
                          : <span style={{ fontSize: 8, color:"rgba(255,255,255,0.22)", border:`1px solid rgba(255,255,255,0.08)`, padding:"1px 4px", letterSpacing:"0.12em" }}>SINGLE</span>}
                        <span style={{ fontSize: 8, color:WEIGHT_COLOR[weight], border:`1px solid ${WEIGHT_COLOR[weight]}44`, padding:"1px 5px", letterSpacing:"0.14em" }}>WEIGHT {weight}</span>
                      </div>
                      <button onClick={() => copyPost(i)} style={{ display:"flex", alignItems:"center", gap:3, color: copiedIdx===i ? ACCENT : "rgba(255,255,255,0.24)", background:"transparent", border:`1px solid ${copiedIdx===i ? BORDA : "rgba(255,255,255,0.05)"}`, padding:"2px 6px", cursor:"pointer", fontFamily:MONO, fontSize: 9 }}>
                        {copiedIdx===i ? <CheckIcon/> : <CopyIcon/>}
                      </button>
                    </div>

                    {/* 4-line structured display */}
                    <div style={{ padding: "8px 11px" }}>
                      <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT, fontWeight: 500, marginBottom: 5 }}>{post.domain} / {post.location}</div>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.86)", lineHeight: 1.55, marginBottom: 4 }}>{post.signal}</div>
                      {post.detail && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.48)", lineHeight: 1.5, marginBottom: 7 }}>{post.detail}</div>}

                      {/* Confidence reasoning */}
                      <div style={{ display:"flex", alignItems:"flex-start", gap:5, padding:"5px 8px", background:"rgba(0,0,0,0.20)", borderLeft:`1px solid rgba(255,255,255,0.08)`, marginBottom:8 }}>
                        <span style={{ fontSize: 8, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.24)", flexShrink:0, marginTop:1 }}>WHY</span>
                        <span style={{ fontSize: 10, color:"rgba(255,255,255,0.42)", lineHeight:1.5 }}>{reason}</span>
                      </div>

                      {/* Editable composer */}
                      <div style={{ borderTop: `1px solid rgba(255,255,255,0.04)`, paddingTop: 7 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}><EditIcon /><span style={{ fontSize: 8, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.20)" }}>Edit before posting</span></div>
                          <span style={{ fontSize: 9, color:counterColor }}>{charLen}/{MAX_CHARS}</span>
                        </div>
                        <textarea
                          value={txt}
                          onChange={(e) => { if (e.target.value.length <= MAX_CHARS) setPostEdits((p) => ({ ...p, [i]: e.target.value })); }}
                          maxLength={MAX_CHARS}
                          style={{ width:"100%", minHeight:64, maxHeight:100, overflowY:"auto", resize:"none", background:"rgba(0,0,0,0.26)", border:`1px solid ${overLimit ? "rgba(224,85,85,0.25)" : "rgba(255,255,255,0.06)"}`, padding:"6px 8px", fontSize: 10, color:"rgba(255,255,255,0.68)", outline:"none", fontFamily:MONO, lineHeight:1.6, boxSizing:"border-box" }} />
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div style={{ padding: "20px 12px", fontSize: 11, color: "rgba(255,255,255,0.22)", textAlign: "center", fontStyle: "italic" }}>
                  {inputLocked ? "Composing intelligence posts..." : "No signals generated — run AUTO SCAN"}
                </div>
              )}
            </div>

            {/* BLACKDOG footer */}
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 13px", borderTop:`1px solid rgba(255,255,255,0.04)` }}>
              <ShieldIcon />
              <span style={{ fontSize: 8, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,0.18)" }}>Protected by BLACKDOG</span>
              {blackDog && <span style={{ fontSize: 9, color:riskColor, marginLeft:"auto" }}>{blackDog.level}</span>}
            </div>
          </div>

          {/* SAGE Analysis */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="SAGE Analysis" right={sage ? <span style={{ fontSize: 9, color: ACCENT }}>ACTIVE</span> : null} />
            <div style={{ padding: "9px 13px" }}>
              {sage ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
                    {[["DOMAIN", sage.DOMAIN], ["LOCATION", sage.LOCATION], ["RISK", `${blackDog?.level ?? "—"} / ${escalationScore ?? 0}`]].map(([k, v]) => (
                      <div key={k} style={{ padding: "6px 9px", background: GLASS2, borderLeft: `2px solid ${BORDA}` }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.20em", textTransform: "uppercase", color: ACCENT, marginBottom: 3 }}>{k}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.72)" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                    {[["WHAT", sage.WHAT], ["WHY", sage.WHY], ["MECHANISM", sage.MECHANISM], ["CHANGING", sage.CHANGING]].map(([k, v]) => (
                      <div key={k} style={{ padding: "6px 9px", background: GLASS2, borderLeft: `1px solid rgba(255,255,255,0.05)` }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.26)", marginBottom: 3 }}>{k}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.24)" }}>{inputLocked ? "Analysis in progress..." : "Awaiting scan"}</div>
              )}
            </div>
          </PanelBox>

          {/* System Log */}
          <PanelBox style={{ flexShrink: 0 }}>
            <PH label="System Log" right={<span style={{ fontSize: 8, color: "rgba(255,255,255,0.18)" }}>{logs.length}</span>} />
            <div ref={logRef} style={{ padding: "7px 12px", height: 88, overflowY: "auto", fontSize: 9, lineHeight: 1.75, color: "rgba(255,255,255,0.32)" }}>
              {logs.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
            </div>
          </PanelBox>
        </div>

        {/* ── RIGHT: SUPPORT RAIL ── */}
        <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>

          {/* Signal Candidates */}
          <div style={{ flexShrink: 0, background: GLASS, border: `1px solid ${BORDER}`, backdropFilter: "blur(16px)", display: "flex", flexDirection: "column", maxHeight: 230, overflow: "hidden" }}>
            <PH label="Signal Candidates" right={candidates.length ? <span style={{ fontSize: 10, color: ACCENT }}>{candidates.length}</span> : null} />
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
              {candidates.length ? candidates.map((c, i) => {
                const sel = selectedUrl === c.url;
                const cs  = c.clusterSize ?? 1;
                return (
                  <button key={`cand-${i}`} onClick={() => promoteCandidate(c)} disabled={inputLocked}
                    style={{ textAlign: "left", padding: "5px 8px", background: sel ? "rgba(0,255,136,0.04)" : "rgba(0,0,0,0.16)", border: `1px solid ${sel ? BORDA : "rgba(255,255,255,0.04)"}`, cursor: "pointer", fontFamily: MONO }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 8, letterSpacing: "0.12em", color: ACCENT }}>{c.feedName}</span>
                        {cs > 1
                          ? <span style={{ fontSize: 7, color: YELLOW, border: `1px solid rgba(232,167,58,0.25)`, padding: "1px 4px", letterSpacing: "0.10em" }}>CLUSTER {cs}</span>
                          : <span style={{ fontSize: 7, color: "rgba(255,255,255,0.20)", border: `1px solid rgba(255,255,255,0.07)`, padding: "1px 4px", letterSpacing: "0.10em" }}>SINGLE</span>}
                      </div>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.22)" }}>{relTime(c.publishedAt)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: sel ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.50)", lineHeight: 1.5 }}>{c.headline.slice(0, 85)}</div>
                  </button>
                );
              }) : (
                <div style={{ padding: "8px", fontSize: 10, color: "rgba(255,255,255,0.22)" }}>{inputLocked ? "Loading..." : "No candidates loaded"}</div>
              )}
            </div>
          </div>

          {/* X Deployment Control */}
          <div style={{ flexShrink: 0, background: GLASS, border: `1px solid ${BORDER}`, backdropFilter: "blur(16px)" }}>
            <PH label="X Deployment Control" />
            {/* Status strip */}
            <div style={{ padding: "7px 12px", borderBottom: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Dot color={deployStatusColor} />
                <span style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: deployStatusColor }}>{deployStatus}</span>
              </div>
              {deployStatus === "X CONNECTED / CONTENT BLOCKED" && (
                <div style={{ marginTop: 5, fontSize: 9, color: "rgba(255,255,255,0.34)", lineHeight: 1.5 }}>{deployBlockReason()}</div>
              )}
              {deployStatus === "X CONNECTED / POSTED" && (
                <div style={{ marginTop: 4, fontSize: 9, color: ACCENT }}>Successfully posted to X.</div>
              )}
            </div>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {xStatus === "X connected" && !xCredsExpanded ? (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.12em", color: ACCENT, marginBottom: 3 }}>AUTHENTICATED</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.36)", lineHeight: 1.8 }}>
                    <div>X STATUS: CONNECTED</div>
                    {xVerifiedAt && <div>VERIFIED: {xVerifiedAt}</div>}
                  </div>
                  <button onClick={() => setXCredsExpanded(true)}
                    style={{ marginTop: 7, display:"flex", alignItems:"center", gap:4, padding:"3px 7px", fontSize: 8, letterSpacing:"0.14em", textTransform:"uppercase", border:`1px solid rgba(255,255,255,0.07)`, color:"rgba(255,255,255,0.36)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>
                    <EditIcon /> EDIT CREDENTIALS
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {([["API KEY", "apiKey"], ["API KEY SECRET", "apiKeySecret"], ["ACCESS TOKEN", "accessToken"], ["ACCESS TOKEN SECRET", "accessTokenSecret"]] as [string, keyof XCreds][]).map(([lbl, k]) => (
                      <div key={k}>
                        <div style={{ fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.26)", marginBottom: 3 }}>{lbl}</div>
                        <input type="password" value={xCreds[k]} onChange={(e) => setXCreds((p) => ({ ...p, [k]: e.target.value }))}
                          style={{ width: "100%", background: "rgba(0,0,0,0.28)", border: `1px solid ${BORDER}`, padding: "5px 7px", fontSize: 10, color: "rgba(255,255,255,0.70)", outline: "none", fontFamily: MONO, boxSizing: "border-box" }} />
                      </div>
                    ))}
                  </div>
                  {xCredsExpanded && <button onClick={() => setXCredsExpanded(false)} style={{ alignSelf:"flex-start", padding:"2px 6px", fontSize: 8, letterSpacing:"0.12em", textTransform:"uppercase", border:`1px solid rgba(255,255,255,0.06)`, color:"rgba(255,255,255,0.30)", background:"transparent", cursor:"pointer", fontFamily:MONO }}>CANCEL</button>}
                </div>
              )}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <Btn onClick={saveXCreds} xs>SAVE</Btn>
                <Btn onClick={testX} xs>TEST</Btn>
                <Btn onClick={clearX} xs>CLEAR</Btn>
                <Btn onClick={postToX} disabled={!canPost} accent={canPost} xs>
                  {posting ? "POSTING..." : posted ? "POSTED ✓" : "POST TO X"}
                </Btn>
              </div>
              {xMessage && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.32)", lineHeight: 1.5 }}>{xMessage}</div>}
            </div>
          </div>

          {/* Scribe Decision */}
          <div style={{ flexShrink: 0, background: GLASS, border: `1px solid ${BORDER}`, backdropFilter: "blur(16px)" }}>
            <PH label="Scribe Decision" />
            <div style={{ padding: "9px 12px" }}>
              <div style={{ padding: "9px 11px", background: GLASS2, borderLeft: `2px solid ${judgementColor}` }}>
                <div style={{ fontSize: 8, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.24)", marginBottom: 5 }}>Terminal Judgement</div>
                <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "0.06em", color: judgementColor, marginBottom: 9 }}>{judgement}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 9, lineHeight: 1.65 }}>
                  {[
                    ["Signals extracted",  `${goodSigs.length} / ${minSentrix} required`],
                    ["Mode requirement",   `${outputMode.replace(/_/g," ")} — ${minAxion}+ posts`],
                    ["Source cluster",     currentClusterSize > 1 ? `${currentClusterSize} sources` : "Single source"],
                    ["Deployment package", ready ? "VALID" : "INVALID"],
                    ["X auth",             xStatus === "X connected" ? "CONNECTED" : "NOT CONNECTED"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ color: "rgba(255,255,255,0.34)" }}>{k}</span>
                      <span style={{ color: v === "VALID" || v === "CONNECTED" ? ACCENT : v === "INVALID" || v === "NOT CONNECTED" ? RED : "rgba(255,255,255,0.52)" }}>{v}</span>
                    </div>
                  ))}
                </div>
                {!ready && !posted && deployBlockReason() && (
                  <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid rgba(255,255,255,0.04)`, fontSize: 9, color: "rgba(255,255,255,0.34)", lineHeight: 1.5 }}>{deployBlockReason()}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{box-shadow:0 0 9px rgba(0,255,136,0.20);} 50%{box-shadow:0 0 18px rgba(0,255,136,0.40);} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(4px);} to{opacity:1;transform:none;} }
        select option { background:#0d1117; }
        ::-webkit-scrollbar { width:2px; height:2px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,255,136,0.14); }
        textarea:focus { border-color:rgba(0,255,136,0.18) !important; }
      `}</style>
    </div>
  );
}
