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

LANGUAGE RULES — HARD ENFORCEMENT:
FORBIDDEN: "said", "according to", "the report states", "it was noted", "reportedly", "sources suggest", "it is believed", "in a significant development", "highlighting", "underscoring"
MANDATORY TONE: compressed • operational • exact • cold • field note, not journalism
EVERY WORD must carry information. No transitions. No hedging. No soft language.
Active voice only. Subject + action + object. Military precision.
Never include raw URLs in any field.

AXION POST QUALITY RULES:
- DOMAIN/LOCATION: be precise — no vague regions. Use "Southern Lebanon", not "the region".
- SIGNAL (LINE 2): Primary tactical development. Compressed active voice. One tight sentence. No narrative.
- DETAIL (LINE 3): Operational implication or mechanism — what changes, what is threatened, what is signaled.
- Target signal field: 60–120 chars. Target detail field: 40–100 chars. Together: 100–220 chars max.
- If you can say it in 8 words instead of 15, use 8.

CONFIDENCE REASONING — generate a precise 1-sentence explanation per post:
- CONFIRMED: cite corroborating sources or official statements
- LIKELY: note the alignment with pattern but absence of secondary confirmation
- CONTESTED: identify the specific conflict between claims or actors
- UNKNOWN: state what is missing or unverifiable

OUTPUT: Valid JSON only — no markdown, no explanation text`;

function modeInstruction(mode: OutputMode): string {
  switch (mode) {
    case "SINGLE_SIGNAL":
      return "Produce exactly 1 post in axion — the single highest-impact signal from the source. Most operationally significant development only.";
    case "RAPID_FIRE":
      return "Produce 3–5 posts in axion. Ultra-compressed. Signal is one sentence max. Detail is one phrase. No verbosity. Prioritize speed and density.";
    case "LONGFORM_INTEL":
      return "Produce 6–8 posts in axion. Full domain coverage. Maximum detail depth. Stack signals across all applicable domains. Do not truncate any domain.";
    case "BREAKING_ALERT":
      return "Produce 1–3 posts in axion. BREAKING format: domain header + one compressed alert signal + one detail sentence. Move fast. Prioritize immediacy.";
    case "THREAD":
    default:
      return "Produce 4–6 posts in axion. Each post MUST represent a DIFFERENT signal domain. P1: primary military/movement event. P2: government/policy response. P3: economic or infrastructure effect. P4+: strategic assessment or secondary signals. No domain repetition across posts.";
  }
}

const USER_PROMPT = (headline: string, body: string, sourceHost: string, scope: string, mode: OutputMode, clusterSize: number) =>
  `HEADLINE: ${headline}
SOURCE: ${sourceHost}
SCOPE: ${scope}
MODE: ${mode}
SOURCE CLUSTER: ${clusterSize} source${clusterSize > 1 ? "s" : ""} (${clusterSize > 1 ? "multi-source — treat as higher confidence baseline" : "single source"})

CONTENT:
${body}

${modeInstruction(mode)}

Return this exact JSON structure:

{
  "sentrix": [
    {
      "text": "Specific factual signal — min 40 chars, compressed, intelligence tone, no URLs",
      "classification": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "label": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "confidence": 0-100,
      "kind": "FACT|CLAIM|CHANGE|CONSEQUENCE|DEVELOPMENT"
    }
  ],
  "sage": {
    "WHAT": "Core event — one compressed intelligence sentence, no hedging",
    "WHY": "Underlying driver — cause or strategic motive",
    "MECHANISM": "How it is unfolding — process, method, or vector",
    "CONSTRAINTS": "Limiting factors on escalation, response, or continuation",
    "CHANGING": "What is shifting from prior state — specific delta",
    "LOCATION": "Specific geographic locations from source",
    "DOMAIN": "Primary domain: Military|Geopolitical|Economic|Cyber|Information|Strategic"
  },
  "axion": [
    {
      "domain": "DOMAIN/SUBDOMAIN (e.g. MILITARY/MOVEMENT, GEOPOLITICAL/POLICY, ECONOMIC/MARKET, CYBER/INFRASTRUCTURE, INFORMATION/NARRATIVE, STRATEGIC POSTURE)",
      "location": "SPECIFIC COUNTRY, REGION, OR OPERATIONAL ZONE — no vague generics",
      "signal": "Primary development — compressed, active voice, tactical, under 120 chars",
      "detail": "Operational implication or mechanism — one tight sentence, under 100 chars",
      "source": "official | OSINT | local | mixed | cluster",
      "confidence": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "confidenceReason": "Precise 1-sentence explanation of why this confidence level — cite what aligns, conflicts, or is absent"
    }
  ],
  "blackDog": {
    "level": "LOW|ELEVATED|HIGH|CRITICAL",
    "reason": "Specific risk rationale from source — no generic language, no 'significant concern'",
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

  logs.push(`[SENTRIX] signal classification`);
  logs.push(`[SAGE] analytical framework`);
  logs.push(`[AXION] building output — mode: ${outputMode}`);
  logs.push(`[BLACK DOG] risk evaluation`);

  let raw: string;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT(headline, body.slice(0, 3200), sourceHost, scope, outputMode, clusterSize) },
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
    ? parsed.axion.filter((p): p is IntelPost => {
        if (!p || typeof p !== "object") return false;
        if (!p.domain || !p.location || !p.signal) return false;
        const text = [p.domain, p.location, p.signal, p.detail ?? ""].join(" ");
        return !containsUrls(text);
      }).slice(0, 8)
    : [];

  const blackDog: RiskOutput = parsed.blackDog ?? { level: "PENDING", reason: "Evaluation incomplete", score: 0 };

  logs.push(`[SENTRIX] ${sentrix.length} signals extracted`);
  logs.push(`[SAGE] complete — domain: ${sage.DOMAIN}`);
  logs.push(`[AXION] ${axion.length} posts — ${outputMode}`);
  logs.push(`[BLACK DOG] ${blackDog.level} (score: ${blackDog.score})`);

  const minSentrix = outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT" ? 1
    : outputMode === "RAPID_FIRE" ? 2 : 3;
  const minAxion = outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT" ? 1
    : outputMode === "RAPID_FIRE" ? 2 : 3;

  let blockedReason = "";
  if (sentrix.length < minSentrix) {
    blockedReason = `Signals extracted: ${sentrix.length}/${minSentrix} required for ${outputMode} mode`;
  } else if (axion.length < minAxion) {
    blockedReason = `Intel posts: ${axion.length}/${minAxion} required for ${outputMode} mode`;
  }

  return { sentrix, sage, axion, blackDog, escalationScore: blackDog.score, blockedReason };
}
