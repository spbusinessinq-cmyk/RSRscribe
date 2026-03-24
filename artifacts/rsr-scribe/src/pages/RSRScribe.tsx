import React, { useEffect, useMemo, useRef, useState } from "react";

const ACCENT = "#00ff88";
const BG = "#020303";
const GLASS = "rgba(9, 20, 16, 0.72)";
const BORDER = "rgba(0, 255, 136, 0.24)";
const RED = "#ff6868";
const PIPELINE = ["INPUT", "SENTRIX", "SAGE", "AXION", "BLACK DOG", "SCRIBE"] as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Classification = "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
type StageName = "IDLE" | "INPUT" | "SENTRIX" | "SAGE" | "AXION" | "BLACK DOG" | "SCRIBE" | "COMPLETE";
type PipelineNodeState = "STANDBY" | "PROCESSING" | "COMPLETE" | "FAILED";
type RiskLevel = "PENDING" | "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
type Scope = "GLOBAL" | "CONFLICT" | "ENERGY" | "CYBER";
type WindowCode = "1H" | "3H" | "6H" | "12H" | "24H";
type OutputMode = "THREAD" | "SINGLE_SIGNAL" | "RAPID_FIRE" | "LONGFORM_INTEL" | "BREAKING_ALERT";
type XStatus = "X not configured" | "X configured" | "X test failed" | "X connected";

type CleanedSource = {
  readableText: string;
  headline: string;
  body: string;
  claims: string[];
  sourceHost: string;
  onlyUrlInput: boolean;
  extracted: boolean;
  issue?: string;
};

type Signal = {
  text: string;
  classification: Classification;
  label: Classification;
  confidence: number;
  kind: "FACT" | "CLAIM" | "CHANGE" | "CONSEQUENCE" | "DEVELOPMENT";
};

type IntelPost = {
  domain: string;
  location: string;
  signal: string;
  detail: string;
  source: string;
  confidence: "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
};

type SageOutput = {
  WHAT: string;
  WHY: string;
  MECHANISM: string;
  CONSTRAINTS: string;
  CHANGING: string;
  LOCATION: string;
  DOMAIN: string;
};

type RiskOutput = {
  level: RiskLevel;
  reason: string;
  score: number;
};

type Candidate = {
  headline: string;
  url: string;
  summary: string;
  sourceHost: string;
  publishedAt: string;
  scope: Scope;
  feedName: string;
  score: number;
};

type XCredentials = {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

type XTestResponse = {
  success: boolean;
  message: string;
  status: XStatus;
};

type PostResponse = {
  success: boolean;
  postedCount: number;
  ids: string[];
  message: string;
};

type AutoScanResponse = {
  success: boolean;
  mode?: "AUTO_SCAN";
  scope?: Scope;
  window?: WindowCode;
  leadCandidate?: Candidate;
  sourceRecord?: {
    headline: string;
    content: string;
    timestamp: string;
    sourceType: "URL";
    sourceHost: string;
    sourceUrl: string;
    summary: string;
    feedName: string;
  };
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

const OUTPUT_MODES: { id: OutputMode; label: string; desc: string }[] = [
  { id: "THREAD",        label: "THREAD",   desc: "4–6 posts · multi-domain" },
  { id: "SINGLE_SIGNAL", label: "SINGLE",   desc: "1 post · top signal only" },
  { id: "RAPID_FIRE",    label: "RAPID",    desc: "3–5 posts · ultra-compressed" },
  { id: "LONGFORM_INTEL",label: "LONGFORM", desc: "6–8 posts · full depth" },
  { id: "BREAKING_ALERT",label: "BREAKING", desc: "1–3 posts · alert format" },
];

const MIN_AXION: Record<OutputMode, number> = {
  THREAD:         3,
  SINGLE_SIGNAL:  1,
  RAPID_FIRE:     2,
  LONGFORM_INTEL: 3,
  BREAKING_ALERT: 1,
};

function formatPostForX(post: IntelPost): string {
  const lines = [
    `${post.domain} — ${post.location}`,
    "",
    post.signal,
  ];
  if (post.detail) lines.push("", `DETAIL: ${post.detail}`);
  if (post.source || post.confidence) {
    lines.push(`SOURCE: ${post.source || "OSINT"} | CONFIDENCE: ${post.confidence || "UNKNOWN"}`);
  }
  return lines.join("\n");
}

const CONFIDENCE_COLOR: Record<string, string> = {
  CONFIRMED: "#00ff88",
  LIKELY:    "#a3e635",
  CONTESTED: "#fbbf24",
  UNKNOWN:   "rgba(255,255,255,0.45)",
};

function Panel({ title, children, rightTitle }: { title: string; children: React.ReactNode; rightTitle?: string }) {
  return (
    <div className="rounded-none border backdrop-blur-md" style={{ background: GLASS, borderColor: BORDER, boxShadow: "0 0 24px rgba(0,255,136,0.06) inset" }}>
      <div className="flex items-center justify-between border-b px-4 py-3 text-[11px] uppercase tracking-[0.28em]" style={{ borderColor: BORDER }}>
        <span className="text-white/90">{title}</span>
        {rightTitle ? <span style={{ color: ACCENT }}>{rightTitle}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function GridBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-20"
      style={{
        backgroundImage:
          "linear-gradient(rgba(0,255,136,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.08) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        maskImage: "radial-gradient(circle at center, black 45%, transparent 95%)",
      }}
    />
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="1" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function RSRScribe() {
  const [input, setInput] = useState("");
  const [inputLocked, setInputLocked] = useState(false);
  const [activeStage, setActiveStage] = useState<StageName>("IDLE");
  const [stageStatuses, setStageStatuses] = useState<Record<string, PipelineNodeState>>(() =>
    Object.fromEntries(PIPELINE.map((stage) => [stage, "STANDBY"]))
  );
  const [cleanedSource, setCleanedSource] = useState<CleanedSource | null>(null);
  const [sentrix, setSentrix] = useState<Signal[] | null>(null);
  const [sage, setSage] = useState<SageOutput | null>(null);
  const [axion, setAxion] = useState<IntelPost[] | null>(null);
  const [blackDog, setBlackDog] = useState<RiskOutput | null>(null);
  const [escalationScore, setEscalationScore] = useState<number | null>(null);
  const [visibleThreadCount, setVisibleThreadCount] = useState(0);
  const [logs, setLogs] = useState<string[]>(["SYSTEM ONLINE", "Awaiting signal input"]);
  const [scope, setScope] = useState<Scope>("GLOBAL");
  const [windowCode, setWindowCode] = useState<WindowCode>("6H");
  const [outputMode, setOutputMode] = useState<OutputMode>("THREAD");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sourceRecord, setSourceRecord] = useState<AutoScanResponse["sourceRecord"] | null>(null);
  const [blockedReason, setBlockedReason] = useState("");
  const [selectedCandidateUrl, setSelectedCandidateUrl] = useState("");
  const [xCredentials, setXCredentials] = useState<XCredentials>({ apiKey: "", apiKeySecret: "", accessToken: "", accessTokenSecret: "" });
  const [xStatus, setXStatus] = useState<XStatus>("X not configured");
  const [xMessage, setXMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const scanGenRef = useRef(0);

  const meaningfulSignals = sentrix?.filter((s) => s.text.length >= 35) ?? [];
  const minAxionCount = MIN_AXION[outputMode];

  const outputContainsUrls = useMemo(() => {
    const parts = [
      ...(sentrix?.map((s) => s.text) ?? []),
      ...(axion?.flatMap((p) => [p.domain, p.location, p.signal, p.detail ?? ""]) ?? []),
      sage?.WHAT ?? "",
      sage?.WHY ?? "",
      sage?.MECHANISM ?? "",
      sage?.CONSTRAINTS ?? "",
      sage?.CHANGING ?? "",
    ].join(" ");
    return /https?:\/\//i.test(parts) || /www\./i.test(parts);
  }, [sentrix, axion, sage]);

  const ready = useMemo(() => {
    if (!cleanedSource?.extracted) return false;
    if (meaningfulSignals.length < 3) return false;
    if (!sage) return false;
    if (!axion || axion.length < minAxionCount) return false;
    if (outputContainsUrls) return false;
    if (!blackDog || blackDog.level === "PENDING") return false;
    return true;
  }, [cleanedSource, meaningfulSignals.length, sage, axion, minAxionCount, outputContainsUrls, blackDog]);

  const postToXEnabled = ready && xStatus === "X connected" && !!axion && axion.length >= minAxionCount && !posting;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => { loadCredentialStatus(); }, []);

  const resetOutputs = () => {
    setCleanedSource(null);
    setSentrix(null);
    setSage(null);
    setAxion(null);
    setBlackDog(null);
    setEscalationScore(null);
    setVisibleThreadCount(0);
    setCandidates([]);
    setSourceRecord(null);
    setBlockedReason("");
    setSelectedCandidateUrl("");
    setActiveStage("INPUT");
    setStageStatuses(Object.fromEntries(PIPELINE.map((stage) => [stage, "STANDBY"])));
  };

  const pushLog = (line: string) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} // ${line}`]);

  const syncStageStatuses = (targetStage: StageName, success = true) => {
    const next = Object.fromEntries(PIPELINE.map((stage) => [stage, "STANDBY"])) as Record<string, PipelineNodeState>;
    const stageIndex = PIPELINE.indexOf(targetStage as never);
    PIPELINE.forEach((stage, index) => {
      if (index < stageIndex) next[stage] = "COMPLETE";
      if (index === stageIndex) next[stage] = success ? "COMPLETE" : "FAILED";
    });
    setStageStatuses(next);
    setActiveStage(success ? "COMPLETE" : targetStage);
  };

  const startPipelineAnimation = (gen: number) => {
    type Step = [string, PipelineNodeState, number];
    const steps: Step[] = [
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
        if (scanGenRef.current !== gen) return;
        setStageStatuses((prev) => ({ ...prev, [stage]: status }));
      }, delay);
    }
  };

  const revealThread = async (posts: IntelPost[] | null | undefined) => {
    setVisibleThreadCount(0);
    if (!posts?.length) return;
    for (let i = 1; i <= posts.length; i++) {
      await sleep(200);
      setVisibleThreadCount(i);
    }
  };

  const applyAutoScanData = async (data: AutoScanResponse) => {
    if (Array.isArray(data.logs) && data.logs.length) {
      setLogs(["SYSTEM ONLINE", ...data.logs]);
    }
    const nextCandidates = data.candidates || [];
    setCandidates(nextCandidates);

    if (!data.success) {
      const message = data.message || data.reason || "No usable feed items returned";
      setBlockedReason(message);
      syncStageStatuses("INPUT", false);
      return;
    }

    const leadUrl = data.sourceRecord?.sourceUrl || data.leadCandidate?.url || nextCandidates[0]?.url || "";
    setSelectedCandidateUrl(leadUrl);
    setSourceRecord(data.sourceRecord || null);
    setCleanedSource(data.cleanedSource || null);
    setSentrix(data.sentrix || null);
    setSage(data.sage || null);
    setAxion(data.axion || null);
    setBlackDog(data.blackDog || null);
    setEscalationScore(data.escalationScore ?? null);
    setBlockedReason(data.blockedReason || "");
    syncStageStatuses("SCRIBE", !data.blockedReason);
    await revealThread(data.axion);
  };

  const relativeTime = (iso?: string) => {
    if (!iso) return "--";
    const delta = Date.now() - new Date(iso).getTime();
    const mins = Math.max(1, Math.floor(delta / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const runScan = async (extraBody: Record<string, unknown> = {}) => {
    if (inputLocked) return;
    resetOutputs();
    setInputLocked(true);
    setLogs(["SYSTEM ONLINE", `AUTO SCAN INITIALIZED — MODE: ${outputMode}`]);

    const gen = ++scanGenRef.current;
    startPipelineAnimation(gen);

    try {
      const response = await fetch("/api/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ scope, window: windowCode, outputMode, ...extraBody }),
      });
      const data: AutoScanResponse = await response.json();
      scanGenRef.current = gen + 1;
      await applyAutoScanData(data);
    } catch (error) {
      scanGenRef.current = gen + 1;
      const message = error instanceof Error ? error.message : "AUTO SCAN request failed";
      setBlockedReason(message);
      setCandidates([]);
      pushLog(`[SCRIBE] blocked — ${message}`);
      syncStageStatuses("INPUT", false);
    } finally {
      setInputLocked(false);
    }
  };

  const promoteCandidate = (candidate: Candidate) => {
    setSelectedCandidateUrl(candidate.url);
    runScan({ leadUrl: candidate.url });
  };

  const loadCredentialStatus = async () => {
    try {
      const response = await fetch("/api/x/credentials", { method: "GET" });
      const data = await response.json();
      setXStatus(data?.status || (data?.configured ? "X configured" : "X not configured"));
      setXMessage(data?.configured ? "X credentials saved" : "X credentials missing");
    } catch {
      setXStatus("X not configured");
      setXMessage("X credentials missing");
    }
  };

  const saveCredentials = async () => {
    try {
      const response = await fetch("/api/x/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(xCredentials),
      });
      const data = await response.json();
      setXStatus(data?.status || (response.ok ? "X configured" : "X not configured"));
      setXMessage(data?.message || (response.ok ? "X credentials saved" : "X credentials missing"));
      pushLog(`[X] ${data?.message || "credentials updated"}`);
    } catch {
      setXStatus("X not configured");
      setXMessage("X credentials missing");
    }
  };

  const testConnection = async () => {
    try {
      const response = await fetch("/api/x/test", { method: "POST" });
      const data: XTestResponse = await response.json();
      setXStatus(data.status);
      setXMessage(data.message);
      pushLog(`[X] ${data.message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "X connection test failed";
      setXStatus("X test failed");
      setXMessage(message);
    }
  };

  const clearCredentials = async () => {
    try { await fetch("/api/x/credentials", { method: "DELETE" }); } catch {}
    setXCredentials({ apiKey: "", apiKeySecret: "", accessToken: "", accessTokenSecret: "" });
    setXStatus("X not configured");
    setXMessage("X credentials cleared");
    pushLog("[X] X credentials cleared");
  };

  const postToX = async () => {
    if (!postToXEnabled || !axion?.length) {
      const message = !ready ? "Deployment blocked — pipeline not ready" : "X connection not verified";
      setXMessage(message);
      return;
    }
    setPosting(true);
    try {
      const lines = axion.map(formatPostForX);
      const response = await fetch("/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: false, mode: "THREAD", lines }),
      });
      const data: PostResponse = await response.json();
      setXMessage(data.message);
      pushLog(`[X] ${data.message}`);
    } catch {
      setXMessage("Posting blocked until deployment-ready");
    } finally {
      setPosting(false);
    }
  };

  const copyLine = (post: IntelPost, index: number) => {
    navigator.clipboard.writeText(formatPostForX(post)).catch(() => {});
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  const copyAll = () => {
    if (!axion?.length) return;
    navigator.clipboard.writeText(axion.map(formatPostForX).join("\n\n---\n\n")).catch(() => {});
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const validation = [
    { label: "Source content readable", ok: !!cleanedSource?.extracted },
    { label: "3+ meaningful signals",   ok: meaningfulSignals.length >= 3 },
    { label: "Sage populated",          ok: !!sage },
    { label: `${minAxionCount}+ intel posts`,  ok: !!axion && axion.length >= minAxionCount },
    { label: "Black Dog evaluated",     ok: !!blackDog && blackDog.level !== "PENDING" },
    { label: "No raw URLs in output",   ok: !outputContainsUrls },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden text-white" style={{ background: BG, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" }}>
      <GridBackground />

      <div className="relative z-10 mx-auto max-w-[1700px] p-4 md:p-6">

        {/* ── HEADER ── */}
        <div className="mb-4 border px-4 py-3 uppercase tracking-[0.28em] text-[11px] md:flex md:items-center md:justify-between" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.28)", boxShadow: "0 0 30px rgba(0,255,136,0.05)" }}>
          <div>
            <div className="text-white">RSR SCRIBE — SIGNAL DEPLOYMENT TERMINAL</div>
            <div className="mt-1" style={{ color: ACCENT }}>AUTO SCAN PREVIEW // BUILD LIVE-4 // FULL-SPECTRUM ENGINE</div>
          </div>
          <div className="mt-3 md:mt-0 flex gap-6 text-[10px] text-white/65">
            <span>MODE // {outputMode.replace("_", " ")}</span>
            <span>STATE // {inputLocked ? "SCANNING" : ready ? "READY" : "BLOCKED"}</span>
            <span>RISK // {blackDog?.level ?? "PENDING"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)_420px]">

          {/* ── LEFT COLUMN ── */}
          <div className="space-y-4">
            <Panel title="STATUS" rightTitle={inputLocked ? "SCANNING" : ready ? "READY" : "BLOCKED"}>
              <div className="space-y-3 text-sm">
                <div className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.22)" }}>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/60">Deployment State</div>
                  <div className="mt-2 text-2xl font-semibold" style={{ color: inputLocked ? ACCENT : ready ? ACCENT : RED }}>
                    {inputLocked ? "SCANNING" : ready ? "READY" : "BLOCKED"}
                  </div>
                  <div className="mt-2 text-white/65 text-xs">
                    {inputLocked ? "Intelligence pipeline running..." : blockedReason || (sourceRecord ? "Lead source loaded into system." : "Awaiting signal input or AUTO SCAN.")}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-white/60">Validation Checklist</div>
                  <div className="space-y-2">
                    {validation.map((item) => (
                      <div key={item.label} className="flex items-center justify-between border px-3 py-2 text-xs" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.18)" }}>
                        <span className="text-white/80">{item.label}</span>
                        <span style={{ color: item.ok ? ACCENT : RED }}>{item.ok ? "PASS" : "FAIL"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-white/60">Lead Source</div>
                  <div className="border px-3 py-3 text-xs leading-6" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.18)" }}>
                    <div>HOST: <span style={{ color: ACCENT }}>{sourceRecord?.sourceHost || "--"}</span></div>
                    <div>FEED: {sourceRecord?.feedName || "--"}</div>
                    <div>TIME: {sourceRecord?.timestamp || "--"}</div>
                    <div className="mt-2 text-white/65">{sourceRecord?.headline || "No source selected."}</div>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="SENTRIX" rightTitle={sentrix ? `${sentrix.length} SIGNALS` : "PENDING"}>
              <div className="space-y-2 text-xs max-h-[380px] overflow-auto pr-1">
                {sentrix?.length ? sentrix.map((signal, index) => (
                  <div key={`${signal.text}-${index}`} className="border px-3 py-2" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <span style={{ color: CONFIDENCE_COLOR[signal.classification] ?? ACCENT }}>{signal.classification}</span>
                      <span className="text-white/45">{signal.confidence}/100</span>
                    </div>
                    <div className="mt-1.5 text-white/80 leading-5">{signal.text}</div>
                  </div>
                )) : (
                  <div className="text-white/50">{inputLocked ? "Pipeline running..." : "Awaiting signal input"}</div>
                )}
              </div>
            </Panel>
          </div>

          {/* ── CENTER COLUMN ── */}
          <div className="space-y-4">
            <Panel title="INPUT TERMINAL" rightTitle={inputLocked ? "LOCKED" : "OPEN"}>
              <div className="space-y-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={inputLocked}
                  placeholder="Awaiting signal input"
                  className="min-h-[100px] w-full resize-none border bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 disabled:opacity-80"
                  style={{ borderColor: BORDER }}
                />

                {/* Output mode selector */}
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/50">Output Mode</div>
                  <div className="flex flex-wrap gap-2">
                    {OUTPUT_MODES.map((m) => {
                      const active = outputMode === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setOutputMode(m.id)}
                          disabled={inputLocked}
                          title={m.desc}
                          className="border px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-all disabled:opacity-50"
                          style={{
                            borderColor: active ? ACCENT : BORDER,
                            color: active ? ACCENT : "rgba(255,255,255,0.55)",
                            background: active ? "rgba(0,255,136,0.1)" : "rgba(0,0,0,0.2)",
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 text-[10px] text-white/35">{OUTPUT_MODES.find((m) => m.id === outputMode)?.desc}</div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="border bg-black/40 px-3 py-3 text-xs uppercase tracking-[0.18em] text-white" style={{ borderColor: BORDER }}>
                    <option value="GLOBAL">GLOBAL</option>
                    <option value="CONFLICT">CONFLICT</option>
                    <option value="ENERGY">ENERGY</option>
                    <option value="CYBER">CYBER</option>
                  </select>
                  <select value={windowCode} onChange={(e) => setWindowCode(e.target.value as WindowCode)} className="border bg-black/40 px-3 py-3 text-xs uppercase tracking-[0.18em] text-white" style={{ borderColor: BORDER }}>
                    <option value="1H">1H</option>
                    <option value="3H">3H</option>
                    <option value="6H">6H</option>
                    <option value="12H">12H</option>
                    <option value="24H">24H</option>
                  </select>
                  <button
                    onClick={() => runScan()}
                    disabled={inputLocked}
                    className="border px-6 py-3 text-xs uppercase tracking-[0.22em] transition-all disabled:cursor-not-allowed"
                    style={{
                      borderColor: inputLocked ? "rgba(0,255,136,0.3)" : ACCENT,
                      color: inputLocked ? "rgba(0,255,136,0.45)" : ACCENT,
                      background: inputLocked ? "rgba(0,255,136,0.04)" : "rgba(0,255,136,0.1)",
                    }}
                  >
                    {inputLocked ? "SCANNING..." : "AUTO SCAN"}
                  </button>
                </div>
              </div>
            </Panel>

            {/* INTELLIGENCE FLOW */}
            <Panel title="INTELLIGENCE FLOW" rightTitle={inputLocked ? "ACTIVE" : activeStage === "IDLE" ? "STANDBY" : activeStage === "COMPLETE" ? "COMPLETE" : activeStage}>
              <div className="overflow-hidden">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                  {PIPELINE.map((stage, index) => {
                    const statusLabel = stageStatuses[stage] ?? "STANDBY";
                    const active = statusLabel === "PROCESSING";
                    const done = statusLabel === "COMPLETE";
                    const failed = statusLabel === "FAILED";
                    return (
                      <div key={stage} className="relative flex flex-col items-center">
                        {index < PIPELINE.length - 1 ? (
                          <div className="absolute left-[56%] top-[24px] hidden h-[2px] w-[92%] md:block" style={{ background: "rgba(255,255,255,0.07)" }}>
                            <div className="h-full" style={{ width: done ? "100%" : "0%", background: failed ? `linear-gradient(90deg, transparent, ${RED}, transparent)` : `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, boxShadow: done ? `0 0 10px ${ACCENT}` : "none", transition: "width 500ms ease" }} />
                          </div>
                        ) : null}
                        <div
                          className="relative z-10 flex h-[48px] w-[48px] items-center justify-center border text-[10px] tracking-[0.16em]"
                          style={{
                            borderColor: failed ? RED : active || done ? ACCENT : BORDER,
                            background: active ? "rgba(0,255,136,0.12)" : failed ? "rgba(255,104,104,0.1)" : "rgba(0,0,0,0.28)",
                            color: failed ? RED : active || done ? ACCENT : "rgba(255,255,255,0.6)",
                            boxShadow: active ? `0 0 18px rgba(0,255,136,0.5), inset 0 0 18px rgba(0,255,136,0.1)` : done ? `0 0 10px rgba(0,255,136,0.2)` : failed ? `0 0 10px rgba(255,104,104,0.25)` : "none",
                            animation: active ? "nodePulse 1.1s ease-in-out infinite" : "none",
                            transition: "all 250ms ease",
                          }}
                        >
                          {index + 1}
                        </div>
                        <div className="mt-3 text-center text-[11px] uppercase tracking-[0.22em] text-white/75">{stage}</div>
                        <div className="mt-1 text-center text-[10px]" style={{ color: active ? ACCENT : failed ? RED : done ? "rgba(0,255,136,0.65)" : "rgba(255,255,255,0.3)" }}>{statusLabel}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Panel>

            {/* SAGE ANALYSIS */}
            <Panel title="SAGE ANALYSIS" rightTitle={sage ? "ACTIVE" : inputLocked ? "PROCESSING" : "PENDING"}>
              {sage ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                    {[
                      ["ESCALATION", `${blackDog?.level ?? "PENDING"} / ${escalationScore ?? 0}`],
                      ["DOMAIN", sage.DOMAIN || "Unassigned"],
                      ["LOCATION", sage.LOCATION || "Undetermined"],
                    ].map(([k, v]) => (
                      <div key={k} className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                        <div className="mb-1.5 text-[10px] uppercase tracking-[0.22em]" style={{ color: ACCENT }}>{k}</div>
                        <div className="text-white/90">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                    {Object.entries({ WHAT: sage.WHAT, WHY: sage.WHY, MECHANISM: sage.MECHANISM, CONSTRAINTS: sage.CONSTRAINTS, "WHAT IS CHANGING": sage.CHANGING }).map(([key, value]) => (
                      <div key={key} className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                        <div className="mb-1.5 text-[10px] uppercase tracking-[0.22em]" style={{ color: ACCENT }}>{key}</div>
                        <div className="text-white/80 leading-5">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-white/50">{inputLocked ? "Pipeline running..." : "Awaiting signal input"}</div>
              )}
            </Panel>
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="space-y-4">

            {/* X DEPLOYMENT DRAFT */}
            <div className="rounded-none border backdrop-blur-md" style={{ background: GLASS, borderColor: BORDER, boxShadow: "0 0 24px rgba(0,255,136,0.06) inset" }}>
              <div className="flex items-center justify-between border-b px-4 py-3 text-[11px] uppercase tracking-[0.28em]" style={{ borderColor: BORDER }}>
                <span className="text-white/90">X DEPLOYMENT DRAFT</span>
                <div className="flex items-center gap-3">
                  {axion && axion.length > 0 && (
                    <button
                      onClick={copyAll}
                      className="flex items-center gap-1.5 border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-all"
                      style={{ borderColor: copiedAll ? ACCENT : "rgba(0,255,136,0.3)", color: copiedAll ? ACCENT : "rgba(255,255,255,0.5)", background: copiedAll ? "rgba(0,255,136,0.08)" : "transparent" }}
                    >
                      {copiedAll ? <CheckIcon /> : <CopyIcon />}
                      {copiedAll ? "COPIED" : "COPY ALL"}
                    </button>
                  )}
                  <span style={{ color: ACCENT }}>{axion ? `${visibleThreadCount}/${axion.length}` : "PENDING"}</span>
                </div>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  {axion?.length ? axion.slice(0, visibleThreadCount).map((post, index) => (
                    <div
                      key={`${post.signal}-${index}`}
                      className="border"
                      style={{ borderColor: BORDER, background: "rgba(0,0,0,0.28)", animation: "fadeLine 260ms ease" }}
                    >
                      {/* Post header bar */}
                      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(0,255,136,0.12)" }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/40">#{index + 1}</span>
                          <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: ACCENT }}>{post.domain}</span>
                        </div>
                        <button
                          onClick={() => copyLine(post, index)}
                          className="border p-1.5 transition-all"
                          style={{ borderColor: copiedIndex === index ? ACCENT : "rgba(0,255,136,0.2)", color: copiedIndex === index ? ACCENT : "rgba(255,255,255,0.3)", background: copiedIndex === index ? "rgba(0,255,136,0.08)" : "transparent" }}
                        >
                          {copiedIndex === index ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </div>
                      {/* Post body */}
                      <div className="px-3 py-3 space-y-2">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">{post.location}</div>
                        <div className="text-sm leading-6 text-white/92 font-medium">{post.signal}</div>
                        {post.detail && (
                          <div className="text-xs leading-5 text-white/65 pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                            <span className="text-white/40 uppercase tracking-[0.15em] text-[10px]">Detail</span>
                            <div className="mt-1">{post.detail}</div>
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-[10px] pt-1">
                          <span className="text-white/35">SRC: {post.source || "—"}</span>
                          <span style={{ color: CONFIDENCE_COLOR[post.confidence] ?? "rgba(255,255,255,0.45)" }}>{post.confidence}</span>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="border px-4 py-5 text-sm text-white/35 italic" style={{ borderColor: "rgba(0,255,136,0.08)", background: "rgba(0,0,0,0.18)" }}>
                      {inputLocked ? "Composing intelligence thread..." : "No signals collected — run AUTO SCAN"}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SIGNAL CANDIDATES */}
            <Panel title="SIGNAL CANDIDATES" rightTitle={candidates.length ? `${candidates.length}` : "NONE"}>
              <div className="space-y-2 text-xs max-h-[200px] overflow-auto pr-1">
                {candidates.length ? candidates.map((item, index) => {
                  const selected = selectedCandidateUrl === item.url;
                  return (
                    <button key={`${item.url}-${index}`} onClick={() => promoteCandidate(item)} disabled={inputLocked} className="w-full border px-3 py-2.5 text-left transition-all disabled:opacity-50" style={{ borderColor: selected ? ACCENT : BORDER, background: selected ? "rgba(0,255,136,0.09)" : "rgba(0,0,0,0.18)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <span style={{ color: ACCENT }}>{item.feedName}</span>
                        <span className="text-white/40">{relativeTime(item.publishedAt)}</span>
                      </div>
                      <div className="mt-1.5 text-white/80 leading-5">{item.headline}</div>
                    </button>
                  );
                }) : (
                  <div className="text-white/45">{inputLocked ? "Loading candidates..." : "No candidates loaded"}</div>
                )}
              </div>
            </Panel>

            {/* X DEPLOYMENT CONTROL */}
            <Panel title="X DEPLOYMENT CONTROL" rightTitle={xStatus}>
              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                {[["API KEY", "apiKey"], ["API KEY SECRET", "apiKeySecret"], ["ACCESS TOKEN", "accessToken"], ["ACCESS TOKEN SECRET", "accessTokenSecret"]].map(([label, key]) => (
                  <div key={key} className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/55">{label}</div>
                    <input type="password" value={xCredentials[key as keyof XCredentials]} onChange={(e) => setXCredentials((prev) => ({ ...prev, [key]: e.target.value }))} className="w-full border bg-black/40 px-3 py-2.5 text-xs text-white outline-none" style={{ borderColor: BORDER }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={saveCredentials} className="border px-3 py-2.5 text-[11px] uppercase tracking-[0.22em]" style={{ borderColor: ACCENT, color: ACCENT, background: "rgba(0,255,136,0.08)" }}>SAVE</button>
                <button onClick={testConnection} className="border px-3 py-2.5 text-[11px] uppercase tracking-[0.22em]" style={{ borderColor: BORDER, color: "white", background: "rgba(255,255,255,0.03)" }}>TEST</button>
                <button onClick={clearCredentials} className="border px-3 py-2.5 text-[11px] uppercase tracking-[0.22em]" style={{ borderColor: BORDER, color: "white", background: "rgba(255,255,255,0.03)" }}>CLEAR</button>
                <button onClick={postToX} disabled={!postToXEnabled} className="border px-3 py-2.5 text-[11px] uppercase tracking-[0.22em] disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: postToXEnabled ? ACCENT : BORDER, color: postToXEnabled ? ACCENT : "white", background: postToXEnabled ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.03)" }}>
                  {posting ? "POSTING..." : "POST TO X"}
                </button>
              </div>
              <div className="mt-2 text-xs text-white/55">{xMessage || "X credentials missing"}</div>
            </Panel>

            {/* SCRIBE DECISION */}
            <Panel title="SCRIBE DECISION" rightTitle={ready ? "READY" : "BLOCKED"}>
              <div className="border px-4 py-4" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.18)" }}>
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/50">Terminal Judgement</div>
                <div className="mt-2 text-3xl font-semibold" style={{ color: ready ? ACCENT : RED }}>{ready ? "READY" : "BLOCKED"}</div>
                <div className="mt-3 text-xs leading-6 text-white/65">
                  {ready ? `Full-spectrum analysis complete. ${axion?.length ?? 0} intel posts ready for deployment.` : blockedReason || "One or more deployment conditions remain unresolved."}
                </div>
              </div>
            </Panel>
          </div>
        </div>

        {/* LIVE SYSTEM LOG */}
        <div className="mt-4">
          <Panel title="LIVE SYSTEM LOG" rightTitle={`${logs.length} ENTRIES`}>
            <div ref={logRef} className="h-[190px] overflow-y-auto border bg-black/35 p-3 text-xs leading-6" style={{ borderColor: BORDER }}>
              {logs.map((line, index) => (
                <div key={`${line}-${index}`} className="text-white/70">{line}</div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <style>{`
        @keyframes nodePulse {
          0%, 100% { box-shadow: 0 0 18px rgba(0,255,136,0.5), inset 0 0 18px rgba(0,255,136,0.1); }
          50%       { box-shadow: 0 0 30px rgba(0,255,136,0.8), inset 0 0 24px rgba(0,255,136,0.2); }
        }
        @keyframes fadeLine {
          0%   { opacity: 0; transform: translateY(5px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
