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

const SYSTEM_PROMPT = `You are RSR SCRIBE — a full-spectrum intelligence signal processor.

MANDATE: Convert raw source material into structured intelligence signals across all domains of power.

SIGNAL DOMAINS (detect any that apply):
1. MILITARY/MOVEMENT — troop movement, air/naval activity, positioning shifts
2. GEOPOLITICAL/POLICY — government decisions, diplomatic positioning, sanctions, legislation
3. ECONOMIC/MARKET — energy prices, capital flow, supply chain disruption, currency instability
4. CYBER/INFRASTRUCTURE — attacks, grid disruptions, telecom outages, system anomalies
5. INFORMATION/NARRATIVE — propaganda shifts, coordinated messaging, narrative alignment
6. STRATEGIC POSTURE — force readiness, escalation signals, deterrence positioning

LANGUAGE RULES — MANDATORY:
- FORBIDDEN: "said", "according to", "the report states", "it was noted", "in a significant development"
- Write like intelligence terminal output: compressed, analytical, tactical
- No narrative sentences. No storytelling tone. High signal density.
- Never include raw URLs in any field
- If source is vague, infer the underlying signal and convert to domain-relevant intelligence

OUTPUT: Valid JSON only — no markdown, no explanation text`;

function modeInstruction(mode: OutputMode): string {
  switch (mode) {
    case "SINGLE_SIGNAL":
      return "Produce exactly 1 post in axion — the single highest-impact signal only. Choose the most operationally significant development.";
    case "RAPID_FIRE":
      return "Produce 3-5 posts in axion. Ultra-compressed: signal field is one tight sentence max. Detail is one phrase. No verbosity. Speed over depth.";
    case "LONGFORM_INTEL":
      return "Produce 6-8 posts in axion. Full domain coverage. Maximum detail depth. Stack signals across all relevant domains. Do not truncate.";
    case "BREAKING_ALERT":
      return "Produce 1-3 posts in axion. Format: DOMAIN — LOCATION only as header. Signal is the key alert. Detail is one compressed sentence. Source is brief. Move fast.";
    case "THREAD":
    default:
      return "Produce 4-6 posts in axion. Each post MUST represent a DIFFERENT signal domain when possible. POST 1: primary event or movement. POST 2: policy or government response. POST 3: economic or infrastructure impact. POST 4+: strategic assessment or secondary signals. No domain repetition.";
  }
}

const USER_PROMPT = (headline: string, body: string, sourceHost: string, scope: string, mode: OutputMode) =>
  `HEADLINE: ${headline}
SOURCE: ${sourceHost}
SCOPE: ${scope}
OUTPUT MODE: ${mode}

ARTICLE:
${body}

${modeInstruction(mode)}

Produce this exact JSON:

{
  "sentrix": [
    {
      "text": "Specific factual signal from source (min 40 chars, no URLs, intelligence tone)",
      "classification": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "label": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "confidence": 0-100,
      "kind": "FACT|CLAIM|CHANGE|CONSEQUENCE|DEVELOPMENT"
    }
  ],
  "sage": {
    "WHAT": "Core event — one compressed intelligence sentence",
    "WHY": "Underlying driver or cause from source",
    "MECHANISM": "How it is unfolding — process or method",
    "CONSTRAINTS": "Limiting factors on escalation or response",
    "CHANGING": "What is shifting — from source",
    "LOCATION": "Specific geographic locations mentioned or 'Unspecified'",
    "DOMAIN": "Primary domain: Military|Geopolitical|Economic|Cyber|Information|Strategic"
  },
  "axion": [
    {
      "domain": "SIGNAL DOMAIN (e.g. GEOPOLITICAL/POLICY, MILITARY/MOVEMENT, ECONOMIC/MARKET, CYBER/INFRASTRUCTURE, INFORMATION/NARRATIVE, STRATEGIC POSTURE)",
      "location": "SPECIFIC COUNTRY, REGION, OR OPERATIONAL ZONE — required, no omissions",
      "signal": "What is happening — compressed, tactical, no narrative, no forbidden phrases",
      "detail": "Operational detail — one compressed sentence with maximum information density",
      "source": "official | OSINT | local | mixed",
      "confidence": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN"
    }
  ],
  "blackDog": {
    "level": "LOW|ELEVATED|HIGH|CRITICAL",
    "reason": "Specific risk rationale from source — no generic language",
    "score": 0-100
  }
}`;

export async function runPipeline(
  headline: string,
  body: string,
  sourceHost: string,
  scope: string,
  logs: string[],
  outputMode: OutputMode = "THREAD"
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
    logs.push("[PIPELINE] insufficient source text for analysis");
    return { ...empty, blockedReason: "Source text too short for analysis" };
  }

  logs.push(`[SENTRIX] running signal classification`);
  logs.push(`[SAGE] generating analytical framework`);
  logs.push(`[AXION] building output — mode: ${outputMode}`);
  logs.push(`[BLACK DOG] running risk evaluation`);

  let raw: string;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT(headline, body.slice(0, 3200), sourceHost, scope, outputMode) },
      ],
    });

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
    ? parsed.axion
        .filter((p): p is IntelPost => {
          if (!p || typeof p !== "object") return false;
          if (!p.domain || !p.location || !p.signal) return false;
          const text = [p.domain, p.location, p.signal, p.detail ?? ""].join(" ");
          return !containsUrls(text);
        })
        .slice(0, 8)
    : [];

  const blackDog: RiskOutput = parsed.blackDog ?? { level: "PENDING", reason: "Evaluation incomplete", score: 0 };

  logs.push(`[SENTRIX] ${sentrix.length} signals extracted`);
  logs.push(`[SAGE] analysis complete`);
  logs.push(`[AXION] ${axion.length} intelligence posts — mode: ${outputMode}`);
  logs.push(`[BLACK DOG] risk level: ${blackDog.level} (${blackDog.score})`);

  // Mode-aware minimums
  const minSentrix = outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT" ? 1
    : outputMode === "RAPID_FIRE" ? 2
    : 3; // THREAD / LONGFORM default

  const minAxion = outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT" ? 1
    : outputMode === "RAPID_FIRE" ? 2
    : 3; // THREAD / LONGFORM default

  let blockedReason = "";
  if (sentrix.length < minSentrix) {
    blockedReason = `Signals extracted: ${sentrix.length}/${minSentrix} required for ${outputMode} mode`;
  } else if (axion.length < minAxion) {
    blockedReason = `Intel posts: ${axion.length}/${minAxion} required for ${outputMode} mode`;
  }

  return { sentrix, sage, axion, blackDog, escalationScore: blackDog.score, blockedReason };
}
