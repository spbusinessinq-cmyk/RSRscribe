import { openai } from "@workspace/integrations-openai-ai-server";

export type Signal = {
  text: string;
  classification: "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
  label: "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
  confidence: number;
  kind: "FACT" | "CLAIM" | "CHANGE" | "CONSEQUENCE" | "DEVELOPMENT";
};

export type SageOutput = {
  WHAT: string;
  WHY: string;
  MECHANISM: string;
  CONSTRAINTS: string;
  CHANGING: string;
  LOCATION: string;
  DOMAIN: string;
};

export type RiskOutput = {
  level: "PENDING" | "LOW" | "ELEVATED" | "HIGH" | "CRITICAL";
  reason: string;
  score: number;
};

export type IntelPost = {
  domain: string;
  location: string;
  signal: string;
  detail: string;
  source: string;
  confidence: "CONFIRMED" | "LIKELY" | "CONTESTED" | "UNKNOWN";
  confidenceReason?: string;
};

export type OutputMode = "THREAD" | "SINGLE_SIGNAL" | "RAPID_FIRE" | "LONGFORM_INTEL" | "BREAKING_ALERT";

export type PipelineOutput = {
  sentrix: Signal[];
  sage: SageOutput;
  axion: IntelPost[];
  blackDog: RiskOutput;
  escalationScore: number;
  blockedReason: string;
};

const SYSTEM_PROMPT = `You are RSR SCRIBE — a classified intelligence signal processor.

MANDATE: Convert raw source material into structured tactical intelligence for operator deployment on X.

SIGNAL DOMAINS — detect every domain that applies:
1. MILITARY/MOVEMENT — force repositioning, strike activity, logistics, naval/air ops, mobilization
2. GEOPOLITICAL/POLICY — government posture, sanctions, diplomatic signals, treaty movement, red lines
3. ECONOMIC/MARKET — supply disruption, price signals, capital flight, sanctions effect, currency pressure
4. CYBER/INFRASTRUCTURE — active intrusions, grid stress, telecom anomalies, supply chain compromise
5. INFORMATION/NARRATIVE — propaganda vector shift, state media alignment, coordinated messaging campaigns
6. STRATEGIC POSTURE — force readiness, escalation ladder movement, deterrence signaling, ROE changes

LANGUAGE RULES — ZERO TOLERANCE:
FORBIDDEN WORDS AND PHRASES: "said", "according to", "the report states", "it was noted", "reportedly",
"sources suggest", "it is believed", "in a significant development", "highlighting", "underscoring",
"has been reported", "confirmed by", "appeared to", "seems to", "indicated that"
MANDATORY: compressed · operational · exact · cold · field note precision, never journalism
EVERY WORD carries information. No hedging. No transitions. No filler. Active voice only.
URLs: never include in any field.

SIGNAL (LINE 2) — STRUCTURAL RULES:
- ONE main subject
- ONE main action
- ONE main event
- Max 120 characters
- Do NOT chain clauses with semicolons or "and" into separate sub-events
- Do NOT merge two different events into one signal line
- BAD: "Iran launched missiles at Israel; Gulf states reported drone interceptions across their airspace"
- GOOD: "Iran launched ballistic missiles toward central Israel"
- BAD: "Sanctions imposed as diplomacy collapses and talks end with no agreement reached by either party"
- GOOD: "US imposed new sanctions package after diplomatic talks collapsed"

DETAIL (LINE 3) — OPERATIONAL IMPLICATION:
- What changes, what is threatened, what is signaled
- One compressed sentence, under 100 characters
- Mechanism or consequence only — no restatement of LINE 2

LOCATION — PRECISION REQUIRED:
- Never "the region", "the area", "internationally"
- Use: "Southern Lebanon", "Northern Gaza", "Eastern Ukraine — Zaporizhzhia Oblast", "Washington; Tehran"
- Multiple locations: semicolon-separated, most relevant first

CONFIDENCE REASONING — FACTOR-BASED (mandatory per post):
Format: "Factor; Factor; Factor" — not a narrative sentence
Use ONLY these analytical factors — never use source names or "reports":
CONFIRMED factors: "multi-source alignment", "official statement present", "secondary corroboration", "event pattern consistent", "no visible contradiction"
LIKELY factors: "single-source report", "no independent state confirmation", "signal consistent with prior pattern", "no contradictory evidence", "partial corroboration"
CONTESTED factors: "conflicting claims present", "no independent arbitration", "event claims in dispute", "contradictory state positions", "unresolved actor dispute"
UNKNOWN factors: "unverified claim", "source credibility unestablished", "insufficient corroborating evidence", "temporal gap present", "origin unclear"
Example: "Single-source report; no independent state confirmation; signal consistent with prior strike pattern"
Example: "Multi-source alignment across regional feeds; no visible contradiction; timing and event language match"

OUTPUT: Valid JSON only — no markdown, no explanation text`;

function modeInstruction(mode: OutputMode): string {
  switch (mode) {
    case "SINGLE_SIGNAL":
      return "Produce exactly 1 post in axion — highest-impact signal only. Most operationally significant development.";
    case "RAPID_FIRE":
      return "Produce 3–5 posts in axion. Each signal is ONE sentence max. Detail is ONE phrase. Ultra-compressed. No verbosity.";
    case "LONGFORM_INTEL":
      return "Produce 6–8 posts in axion. Full domain coverage. Maximum specificity per post. Every applicable domain must appear.";
    case "BREAKING_ALERT":
      return "Produce 1–3 posts in axion. BREAKING format: sharp header + one compressed alert signal + one compressed implication. Move fast.";
    case "THREAD":
    default:
      return "Produce 4–6 posts in axion. Each post MUST be a DIFFERENT signal domain. P1: primary military/movement event. P2: government/policy response. P3: economic or infrastructure impact. P4+: strategic posture or secondary signals. No domain repetition.";
  }
}

const USER_PROMPT = (headline: string, body: string, sourceHost: string, scope: string, mode: OutputMode, clusterSize: number) =>
  `HEADLINE: ${headline}
SOURCE HOST: ${sourceHost}
SCOPE: ${scope}
MODE: ${mode}
SOURCE CLUSTER: ${clusterSize} source${clusterSize > 1 ? `s` : ""} — ${clusterSize > 1 ? "multi-source signal; raise confidence baseline" : "single source; conservative confidence"}

CONTENT:
${body}

${modeInstruction(mode)}

Return this exact JSON:

{
  "sentrix": [
    {
      "text": "Specific factual signal, min 40 chars, compressed, no URLs, intelligence tone",
      "classification": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "label": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "confidence": 0-100,
      "kind": "FACT|CLAIM|CHANGE|CONSEQUENCE|DEVELOPMENT"
    }
  ],
  "sage": {
    "WHAT": "Core event — one compressed intelligence sentence, no hedging, active voice",
    "WHY": "Underlying driver — causal mechanism or strategic motive, not description",
    "MECHANISM": "How it is unfolding — process, method, or operational vector",
    "CONSTRAINTS": "Limiting factors on escalation, continuation, or response",
    "CHANGING": "What is shifting from prior state — specific operational delta",
    "LOCATION": "Specific geographic locations — never 'the region'",
    "DOMAIN": "Primary domain: Military|Geopolitical|Economic|Cyber|Information|Strategic"
  },
  "axion": [
    {
      "domain": "DOMAIN/SUBDOMAIN (MILITARY/MOVEMENT, GEOPOLITICAL/POLICY, ECONOMIC/MARKET, CYBER/INFRASTRUCTURE, INFORMATION/NARRATIVE, STRATEGIC POSTURE)",
      "location": "SPECIFIC OPERATIONAL ZONE — no generic regions, no omissions",
      "signal": "ONE subject + ONE action + ONE event, under 120 chars, active voice",
      "detail": "Operational implication or mechanism, under 100 chars, not a restatement",
      "source": "official | OSINT | local | mixed | cluster",
      "confidence": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "confidenceReason": "Factor; Factor; Factor — analytical factors only, no source names, no narrative"
    }
  ],
  "blackDog": {
    "level": "LOW|ELEVATED|HIGH|CRITICAL",
    "reason": "Specific operational risk from source — one compressed sentence, no generic language",
    "score": 0-100
  }
}`;

export async function runPipeline(
  headline: string,
  body: string,
  sourceHost: string,
  scope: string,
  logs: string[],
  outputMode: OutputMode = "THREAD",
  clusterSize = 1
): Promise<PipelineOutput> {
  const empty: PipelineOutput = {
    sentrix: [],
    sage: { WHAT: "", WHY: "", MECHANISM: "", CONSTRAINTS: "", CHANGING: "", LOCATION: "", DOMAIN: "" },
    axion: [],
    blackDog: { level: "PENDING", reason: "", score: 0 },
    escalationScore: 0,
    blockedReason: "",
  };

  if (!body || body.length < 100) {
    logs.push("[PIPELINE] insufficient source text");
    return { ...empty, blockedReason: "Source text too short for analysis" };
  }

  logs.push(`[SENTRIX] signal classification — cluster: ${clusterSize}`);
  logs.push(`[SAGE] analytical framework`);
  logs.push(`[AXION] building output — mode: ${outputMode}`);
  logs.push(`[BLACK DOG] risk evaluation`);

  let raw: string;
  try {
    const aiTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI call timed out after 28s")), 28000)
    );
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 1500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: USER_PROMPT(headline, body.slice(0, 2400), sourceHost, scope, outputMode, clusterSize) },
        ],
      }),
      aiTimeout,
    ]);
    const choice = completion.choices[0];
    raw = choice?.message?.content ?? "";
    if (!raw) {
      logs.push(`[PIPELINE] empty model response — finish_reason: ${choice?.finish_reason ?? "none"}`);
      return { ...empty, blockedReason: "AI model returned empty response" };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logs.push(`[PIPELINE] LLM call failed — ${reason}`);
    return { ...empty, blockedReason: `Analysis failed: ${reason}` };
  }

  let parsed: Partial<{ sentrix: Signal[]; sage: SageOutput; axion: IntelPost[]; blackDog: RiskOutput }>;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const jsonStr = cleaned.includes("{") ? cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1) : cleaned;
    parsed = JSON.parse(jsonStr);
  } catch {
    logs.push(`[PIPELINE] JSON parse failed — raw[:200]: ${raw.slice(0, 200)}`);
    return { ...empty, blockedReason: "Analysis output could not be parsed" };
  }

  const containsUrls = (t: string) => /https?:\/\//i.test(t) || /www\./i.test(t);

  const sentrix = Array.isArray(parsed.sentrix)
    ? parsed.sentrix.filter((s) => s.text?.length >= 35 && !containsUrls(s.text)).slice(0, 8)
    : [];

  const sage: SageOutput = parsed.sage ?? empty.sage;

  const axion: IntelPost[] = Array.isArray(parsed.axion)
    ? parsed.axion.filter((p): p is IntelPost => {
        if (!p || typeof p !== "object") return false;
        if (!p.domain || !p.location || !p.signal) return false;
        const text = [p.domain, p.location, p.signal, p.detail ?? ""].join(" ");
        return !containsUrls(text);
      }).slice(0, 8)
    : [];

  const blackDog: RiskOutput = parsed.blackDog ?? { level: "PENDING", reason: "Evaluation incomplete", score: 0 };

  logs.push(`[SENTRIX] ${sentrix.length} signals`);
  logs.push(`[SAGE] complete — domain: ${sage.DOMAIN}`);
  logs.push(`[AXION] ${axion.length} posts — ${outputMode}`);
  logs.push(`[BLACK DOG] ${blackDog.level} (score: ${blackDog.score})`);

  const minSentrix = outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT" ? 1 : outputMode === "RAPID_FIRE" ? 2 : 3;
  const minAxion   = outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT" ? 1 : outputMode === "RAPID_FIRE" ? 2 : 3;

  let blockedReason = "";
  if (sentrix.length < minSentrix) {
    blockedReason = `Signals extracted: ${sentrix.length}/${minSentrix} required for ${outputMode} mode`;
  } else if (axion.length < minAxion) {
    blockedReason = `Intel posts: ${axion.length}/${minAxion} required for ${outputMode} mode`;
  }

  return { sentrix, sage, axion, blackDog, escalationScore: blackDog.score, blockedReason };
}
