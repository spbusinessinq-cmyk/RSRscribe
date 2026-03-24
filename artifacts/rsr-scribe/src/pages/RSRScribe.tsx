import React, { useEffect, useMemo, useRef, useState } from "react";

const ACCENT = "#00ff88";
const BG = "#020303";
const GLASS = "rgba(9, 20, 16, 0.72)";
const BORDER = "rgba(0, 255, 136, 0.24)";
const PIPELINE = ["INPUT", "SENTRIX", "SAGE", "AXION", "BLACK DOG", "SCRIBE"] as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Classification = "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
type StageName = "IDLE" | "INPUT" | "SENTRIX" | "SAGE" | "AXION" | "BLACK DOG" | "SCRIBE" | "COMPLETE";
type PipelineNodeState = "STANDBY" | "PROCESSING" | "COMPLETE" | "FAILED";
type RiskLevel = "PENDING" | "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
type Scope = "GLOBAL" | "CONFLICT" | "ENERGY" | "CYBER";
type WindowCode = "1H" | "3H" | "6H" | "12H" | "24H";
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
  axion?: string[];
  blackDog?: RiskOutput;
  escalationScore?: number;
  ready?: boolean;
  blockedReason?: string;
  reason?: string;
  message?: string;
  logs?: string[];
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
  const [axion, setAxion] = useState<string[] | null>(null);
  const [blackDog, setBlackDog] = useState<RiskOutput | null>(null);
  const [escalationScore, setEscalationScore] = useState<number | null>(null);
  const [visibleThreadCount, setVisibleThreadCount] = useState(0);
  const [logs, setLogs] = useState<string[]>(["SYSTEM ONLINE", "Awaiting signal input"]);
  const [scope, setScope] = useState<Scope>("GLOBAL");
  const [windowCode, setWindowCode] = useState<WindowCode>("6H");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sourceRecord, setSourceRecord] = useState<AutoScanResponse["sourceRecord"] | null>(null);
  const [blockedReason, setBlockedReason] = useState("");
  const [selectedCandidateUrl, setSelectedCandidateUrl] = useState("");
  const [xCredentials, setXCredentials] = useState<XCredentials>({ apiKey: "", apiKeySecret: "", accessToken: "", accessTokenSecret: "" });
  const [xStatus, setXStatus] = useState<XStatus>("X not configured");
  const [xMessage, setXMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const meaningfulSignals = sentrix?.filter((s) => s.text.length >= 35) ?? [];
  const outputContainsUrls = useMemo(() => {
    const allText = [
      ...(sentrix?.map((s) => s.text) ?? []),
      ...(axion ?? []),
      sage?.WHAT ?? "",
      sage?.WHY ?? "",
      sage?.MECHANISM ?? "",
      sage?.CONSTRAINTS ?? "",
      sage?.CHANGING ?? "",
    ].join(" ");
    return /https?:\/\//i.test(allText) || /www\./i.test(allText);
  }, [sentrix, axion, sage]);

  const ready = useMemo(() => {
    if (!cleanedSource?.extracted) return false;
    if (meaningfulSignals.length < 3) return false;
    if (!sage) return false;
    if (!axion || axion.length < 3) return false;
    if (outputContainsUrls) return false;
    if (!blackDog || blackDog.level === "PENDING") return false;
    return true;
  }, [cleanedSource, meaningfulSignals.length, sage, axion, outputContainsUrls, blackDog]);

  const postToXEnabled = ready && xStatus === "X connected" && !!axion && axion.length >= 3 && !posting;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    loadCredentialStatus();
  }, []);

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

  const revealThread = async (lines: string[] | null | undefined) => {
    setVisibleThreadCount(0);
    if (!lines?.length) return;
    for (let i = 1; i <= lines.length; i += 1) {
      await sleep(180);
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
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const processSignal = async () => {
    if (!input.trim() || inputLocked) return;
    resetOutputs();
    setInputLocked(true);
    try {
      pushLog("[INPUT] source received");
      setStageStatuses((prev) => ({ ...prev, INPUT: "COMPLETE", SENTRIX: "PROCESSING" }));
      await sleep(300);
      pushLog("[MANUAL] preview mode is wired for AUTO SCAN route, not local parser");
      setBlockedReason("Manual preview path is not wired in this preview build.");
      setStageStatuses((prev) => ({ ...prev, SENTRIX: "FAILED" }));
      setActiveStage("SENTRIX");
    } finally {
      setInputLocked(false);
    }
  };

  const runAutoScan = async () => {
    if (inputLocked) return;
    resetOutputs();
    setInputLocked(true);
    setLogs(["SYSTEM ONLINE", "AUTO SCAN INITIALIZED"]);
    pushLog("[AUTO SCAN] started");
    pushLog(`[AUTO SCAN] scope=${scope} window=${windowCode}`);

    try {
      const response = await fetch("/api/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ scope, window: windowCode }),
      });

      const data: AutoScanResponse = await response.json();
      await applyAutoScanData(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AUTO SCAN request failed";
      setBlockedReason(message);
      setCandidates([]);
      pushLog(`[SCRIBE] blocked — ${message}`);
      syncStageStatuses("INPUT", false);
    } finally {
      setInputLocked(false);
    }
  };

  const promoteCandidate = async (candidate: Candidate) => {
    if (inputLocked) return;
    setInputLocked(true);
    setSelectedCandidateUrl(candidate.url);
    pushLog(`[RANK] lead candidate selected: ${candidate.headline}`);

    try {
      const response = await fetch("/api/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ scope, window: windowCode, leadUrl: candidate.url }),
      });

      const data: AutoScanResponse = await response.json();
      await applyAutoScanData(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Candidate selection failed";
      setBlockedReason(message);
      pushLog(`[SCRIBE] blocked — ${message}`);
    } finally {
      setInputLocked(false);
    }
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
      pushLog("[X] X credentials missing");
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
      pushLog(`[X] ${message}`);
    }
  };

  const clearCredentials = async () => {
    try {
      await fetch("/api/x/credentials", { method: "DELETE" });
    } catch {}
    setXCredentials({ apiKey: "", apiKeySecret: "", accessToken: "", accessTokenSecret: "" });
    setXStatus("X not configured");
    setXMessage("X credentials cleared");
    pushLog("[X] X credentials cleared");
  };

  const postToX = async (preview = false) => {
    if ((!postToXEnabled && !preview) || !axion?.length) {
      const message = !ready ? "Posting blocked until deployment-ready" : xStatus !== "X connected" ? "X connection test failed" : "Posting blocked until deployment-ready";
      setXMessage(message);
      pushLog(`[X] ${message}`);
      return;
    }

    setPosting(true);
    try {
      const response = await fetch("/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview, mode: "THREAD", lines: axion }),
      });
      const data: PostResponse = await response.json();
      setXMessage(data.message);
      pushLog(`[X] ${data.message}`);
    } catch {
      setXMessage("Posting blocked until deployment-ready");
      pushLog("[X] Posting blocked until deployment-ready");
    } finally {
      setPosting(false);
    }
  };

  const validation = [
    { label: "Source content readable", ok: !!cleanedSource?.extracted },
    { label: "3+ meaningful signals", ok: meaningfulSignals.length >= 3 },
    { label: "Sage populated", ok: !!sage },
    { label: "Axion readable", ok: !!axion && axion.length >= 3 },
    { label: "Black Dog evaluated", ok: !!blackDog && blackDog.level !== "PENDING" },
    { label: "No raw URLs in output", ok: !outputContainsUrls },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden text-white" style={{ background: BG, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" }}>
      <GridBackground />

      <div className="relative z-10 mx-auto max-w-[1700px] p-4 md:p-6">
        <div className="mb-4 border px-4 py-3 uppercase tracking-[0.28em] text-[11px] md:flex md:items-center md:justify-between" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.28)", boxShadow: "0 0 30px rgba(0,255,136,0.05)" }}>
          <div>
            <div className="text-white">RSR SCRIBE — SIGNAL DEPLOYMENT TERMINAL</div>
            <div className="mt-1" style={{ color: ACCENT }}>AUTO SCAN PREVIEW // BUILD LIVE-3</div>
          </div>
          <div className="mt-3 md:mt-0 flex gap-6 text-[10px] text-white/65">
            <span>MODE // ONE-BUTTON COLLECTION</span>
            <span>STATE // {ready ? "READY" : "BLOCKED"}</span>
            <span>RISK // {blackDog?.level ?? "PENDING"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <Panel title="STATUS" rightTitle={ready ? "READY" : "BLOCKED"}>
              <div className="space-y-3 text-sm">
                <div className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.22)" }}>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/60">Deployment State</div>
                  <div className="mt-2 text-2xl font-semibold" style={{ color: ready ? ACCENT : "#ff6868" }}>{ready ? "READY" : "BLOCKED"}</div>
                  <div className="mt-2 text-white/65 text-xs">{blockedReason || (sourceRecord ? "Lead source loaded into system." : "Awaiting signal input or AUTO SCAN.")}</div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-white/60">Validation Checklist</div>
                  <div className="space-y-2">
                    {validation.map((item) => (
                      <div key={item.label} className="flex items-center justify-between border px-3 py-2 text-xs" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.18)" }}>
                        <span className="text-white/80">{item.label}</span>
                        <span style={{ color: item.ok ? ACCENT : "#ff6868" }}>{item.ok ? "PASS" : "FAIL"}</span>
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
                      <span style={{ color: ACCENT }}>{signal.classification}</span>
                      <span className="text-white/50">{signal.confidence}/100</span>
                    </div>
                    <div className="mt-2 text-white/80 leading-5">{signal.text}</div>
                  </div>
                )) : <div className="text-white/55">Awaiting signal input</div>}
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="INPUT TERMINAL" rightTitle={inputLocked ? "LOCKED" : "OPEN"}>
              <div className="space-y-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={inputLocked}
                  placeholder="Awaiting signal input"
                  className="min-h-[150px] w-full resize-none border bg-black/40 px-4 py-4 text-sm text-white outline-none placeholder:text-white/25 disabled:opacity-80"
                  style={{ borderColor: BORDER, boxShadow: inputLocked ? "0 0 16px rgba(0,255,136,0.08) inset" : "none" }}
                />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
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
                  <button onClick={processSignal} disabled={!input.trim() || inputLocked} className="border px-5 py-3 text-xs uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: ACCENT, color: ACCENT, background: "rgba(0,255,136,0.08)" }}>
                    {inputLocked ? "PROCESSING" : "PROCESS SIGNAL"}
                  </button>
                  <button onClick={runAutoScan} disabled={inputLocked} className="border px-5 py-3 text-xs uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: ACCENT, color: ACCENT, background: "rgba(0,255,136,0.08)" }}>
                    AUTO SCAN
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="PIPELINE VISUALIZATION" rightTitle={activeStage === "IDLE" ? "STANDBY" : activeStage}>
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
                          <div className="absolute left-[56%] top-[24px] hidden h-[2px] w-[92%] md:block" style={{ background: "rgba(255,255,255,0.08)" }}>
                            <div className="h-full" style={{ width: done || active ? "100%" : "0%", background: failed ? "linear-gradient(90deg, transparent, #ff6868, transparent)" : `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, boxShadow: active ? `0 0 14px ${ACCENT}` : done ? `0 0 10px ${ACCENT}` : failed ? "0 0 10px #ff6868" : "none", transition: "width 450ms ease, box-shadow 300ms ease", backgroundSize: "180% 100%", animation: active ? "flowline 1.1s linear infinite" : undefined }} />
                          </div>
                        ) : null}
                        <div className="relative z-10 flex h-[48px] w-[48px] items-center justify-center border text-[10px] tracking-[0.16em]" style={{ borderColor: failed ? "#ff6868" : active || done ? ACCENT : BORDER, background: active ? "rgba(0,255,136,0.12)" : failed ? "rgba(255,104,104,0.1)" : "rgba(0,0,0,0.28)", color: failed ? "#ff6868" : active || done ? ACCENT : "rgba(255,255,255,0.65)", boxShadow: active ? `0 0 16px rgba(0,255,136,0.45), inset 0 0 16px rgba(0,255,136,0.08)` : done ? `0 0 10px rgba(0,255,136,0.18)` : failed ? `0 0 10px rgba(255,104,104,0.22)` : "none", transition: "all 220ms ease" }}>
                          {index + 1}
                        </div>
                        <div className="mt-3 text-center text-[11px] uppercase tracking-[0.22em] text-white/75">{stage}</div>
                        <div className="mt-2 text-center text-[10px] text-white/45">{statusLabel}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Panel>

            <Panel title="SAGE ANALYSIS" rightTitle={sage ? "ACTIVE" : "PENDING"}>
              {sage ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                    <div className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: ACCENT }}>ESCALATION LEVEL</div>
                      <div className="text-white/90">{blackDog?.level ?? "PENDING"} / {escalationScore ?? 0}</div>
                    </div>
                    <div className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: ACCENT }}>DOMAIN</div>
                      <div className="text-white/90">{sage.DOMAIN || "Unassigned"}</div>
                    </div>
                    <div className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: ACCENT }}>LOCATION</div>
                      <div className="text-white/90">{sage.LOCATION || "Undetermined"}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                    {Object.entries({ WHAT: sage.WHAT, WHY: sage.WHY, MECHANISM: sage.MECHANISM, CONSTRAINTS: sage.CONSTRAINTS, "WHAT IS CHANGING": sage.CHANGING }).map(([key, value]) => (
                      <div key={key} className="border px-3 py-3" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.2)" }}>
                        <div className="mb-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: ACCENT }}>{key}</div>
                        <div className="text-white/80 leading-6">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div className="text-sm text-white/50">Awaiting signal input</div>}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="OUTPUT THREAD" rightTitle={axion ? `${visibleThreadCount}/${axion.length}` : "PENDING"}>
              <div className="space-y-3 text-sm">
                {axion?.length ? axion.slice(0, visibleThreadCount).map((line, index) => (
                  <div key={`${line}-${index}`} className="border px-4 py-3 text-white/90" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.24)", animation: "fadeLine 260ms ease" }}>{line}</div>
                )) : <div className="text-white/50">Awaiting signal input</div>}
              </div>
            </Panel>

            <Panel title="TOP CANDIDATES" rightTitle={candidates.length ? `${candidates.length}` : "NONE"}>
              <div className="space-y-2 text-xs max-h-[240px] overflow-auto pr-1">
                {candidates.length ? candidates.map((item, index) => {
                  const selected = selectedCandidateUrl === item.url;
                  return (
                    <button key={`${item.url}-${index}`} onClick={() => promoteCandidate(item)} className="w-full border px-3 py-3 text-left" style={{ borderColor: selected ? ACCENT : BORDER, background: selected ? "rgba(0,255,136,0.09)" : "rgba(0,0,0,0.18)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <span style={{ color: ACCENT }}>{item.feedName}</span>
                        <span className="text-white/50">{item.score}</span>
                      </div>
                      <div className="mt-2 text-white/85 leading-5">{item.headline}</div>
                      <div className="mt-2 flex items-center justify-between text-white/45">
                        <span>{item.sourceHost}</span>
                        <span>{relativeTime(item.publishedAt)}</span>
                      </div>
                    </button>
                  );
                }) : <div className="text-white/50">No candidates loaded</div>}
              </div>
            </Panel>

            <Panel title="X INTEGRATION" rightTitle={xStatus}>
              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                {[
                  ["API KEY", "apiKey"],
                  ["API KEY SECRET", "apiKeySecret"],
                  ["ACCESS TOKEN", "accessToken"],
                  ["ACCESS TOKEN SECRET", "accessTokenSecret"],
                ].map(([label, key]) => (
                  <div key={key} className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/60">{label}</div>
                    <input type="password" value={xCredentials[key as keyof XCredentials]} onChange={(e) => setXCredentials((prev) => ({ ...prev, [key]: e.target.value }))} className="w-full border bg-black/40 px-3 py-3 text-xs text-white outline-none" style={{ borderColor: BORDER }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button onClick={saveCredentials} className="border px-4 py-3 text-[11px] uppercase tracking-[0.22em]" style={{ borderColor: ACCENT, color: ACCENT, background: "rgba(0,255,136,0.08)" }}>SAVE CREDENTIALS</button>
                <button onClick={testConnection} className="border px-4 py-3 text-[11px] uppercase tracking-[0.22em]" style={{ borderColor: BORDER, color: "white", background: "rgba(255,255,255,0.03)" }}>TEST CONNECTION</button>
                <button onClick={clearCredentials} className="border px-4 py-3 text-[11px] uppercase tracking-[0.22em]" style={{ borderColor: BORDER, color: "white", background: "rgba(255,255,255,0.03)" }}>CLEAR CREDENTIALS</button>
                <button onClick={() => postToX(false)} disabled={!postToXEnabled} className="border px-4 py-3 text-[11px] uppercase tracking-[0.22em] disabled:opacity-40" style={{ borderColor: postToXEnabled ? ACCENT : BORDER, color: postToXEnabled ? ACCENT : "white", background: postToXEnabled ? "rgba(0,255,136,0.08)" : "rgba(255,255,255,0.03)" }}>POST TO X</button>
              </div>
              <div className="mt-3 text-xs text-white/65">{xMessage || "X credentials missing"}</div>
            </Panel>

            <Panel title="SCRIBE DECISION" rightTitle={ready ? "READY" : "BLOCKED"}>
              <div className="border px-4 py-4" style={{ borderColor: BORDER, background: "rgba(0,0,0,0.18)" }}>
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">Terminal Judgement</div>
                <div className="mt-2 text-3xl font-semibold" style={{ color: ready ? ACCENT : "#ff6868" }}>{ready ? "READY" : "BLOCKED"}</div>
                <div className="mt-3 text-xs leading-6 text-white/70">{ready ? "AUTO SCAN collected a usable lead, ingested readable content, and produced deployment output." : blockedReason || "One or more deployment conditions remain unresolved."}</div>
              </div>
            </Panel>
          </div>
        </div>

        <div className="mt-4">
          <Panel title="LIVE SYSTEM LOG" rightTitle={`${logs.length} ENTRIES`}>
            <div ref={logRef} className="h-[220px] overflow-y-auto border bg-black/35 p-3 text-xs leading-6" style={{ borderColor: BORDER }}>
              {logs.map((line, index) => (
                <div key={`${line}-${index}`} className="text-white/78">{line}</div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <style>{`
        @keyframes flowline {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes fadeLine {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
