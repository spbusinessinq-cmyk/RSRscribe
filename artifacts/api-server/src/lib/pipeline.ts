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

export type PipelineOutput = {
  sentrix: Signal[];
  sage: SageOutput;
  axion: string[];
  blackDog: RiskOutput;
  escalationScore: number;
  blockedReason: string;
};

const SYSTEM_PROMPT = `You are RSR SCRIBE — an intelligence analyst producing structured outputs from real source material.

RULES:
- All outputs derive directly from the source text
- Never invent facts, actors, or locations not in the source
- Never include raw URLs anywhere in any output field
- SENTRIX signals must be specific factual claims or developments from the text
- SAGE analysis must be grounded, not generic
- AXION posts are the final thread: punchy, publish-ready, factual
- If evidence is thin, say so honestly — not everything is HIGH risk
- Output valid JSON only — no markdown, no explanation text`;

const USER_PROMPT = (headline: string, body: string, sourceHost: string, scope: string) =>
  `HEADLINE: ${headline}
SOURCE: ${sourceHost}
SCOPE: ${scope}

ARTICLE:
${body}

Produce this JSON:

{
  "sentrix": [
    {
      "text": "Specific factual claim from source (min 40 chars, no URLs)",
      "classification": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "label": "CONFIRMED|LIKELY|CONTESTED|UNKNOWN",
      "confidence": 0-100,
      "kind": "FACT|CLAIM|CHANGE|CONSEQUENCE|DEVELOPMENT"
    }
  ],
  "sage": {
    "WHAT": "Core event — one concise sentence",
    "WHY": "Underlying cause or driver from source",
    "MECHANISM": "How it is unfolding",
    "CONSTRAINTS": "Limiting factors on response or escalation",
    "CHANGING": "What is shifting from the source",
    "LOCATION": "Geographic locations in source or 'Unspecified'",
    "DOMAIN": "Cybersecurity|Energy Markets|Geopolitical|Military|Economic|Technology|Other"
  },
  "axion": [
    "Post 1 — lead with the strongest confirmed fact. Concise. Max 220 chars.",
    "Post 2 — different sentence structure. New information only.",
    "Post 3 — context, actor, or consequence not in Post 1 or 2.",
    "Post 4 — uncertainty or constraint if relevant, otherwise next key fact."
  ],
  "blackDog": {
    "level": "LOW|ELEVATED|HIGH|CRITICAL",
    "reason": "Specific rationale from source — no generic placeholders",
    "score": 0-100
  }
}

AXION rules: no URLs, no hashtags, no emojis, no filler phrases like 'It is worth noting' or 'In a significant development'. Each post must stand alone. Vary structure. No sentence should start the same way as another.`;

export async function runPipeline(
  headline: string,
  body: string,
  sourceHost: string,
  scope: string,
  logs: string[]
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

  logs.push("[SENTRIX] running signal classification");
  logs.push("[SAGE] generating analytical framework");
  logs.push("[AXION] building output thread");
  logs.push("[BLACK DOG] running risk evaluation");

  let raw: string;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT(headline, body.slice(0, 3200), sourceHost, scope) },
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

  let parsed: Partial<{ sentrix: Signal[]; sage: SageOutput; axion: string[]; blackDog: RiskOutput }>;

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
  const axion = Array.isArray(parsed.axion)
    ? parsed.axion.filter((l) => typeof l === "string" && l.length > 0 && !containsUrls(l)).slice(0, 6)
    : [];
  const blackDog: RiskOutput = parsed.blackDog ?? { level: "PENDING", reason: "Evaluation incomplete", score: 0 };

  logs.push(`[SENTRIX] ${sentrix.length} signals extracted`);
  logs.push(`[SAGE] analysis complete`);
  logs.push(`[AXION] ${axion.length} deployment lines generated`);
  logs.push(`[BLACK DOG] risk level: ${blackDog.level} (${blackDog.score})`);

  let blockedReason = "";
  if (sentrix.length < 3) {
    blockedReason = `Only ${sentrix.length} meaningful signals extracted — minimum 3 required`;
  } else if (axion.length < 3) {
    blockedReason = `Only ${axion.length} clean output lines — minimum 3 required`;
  }

  return { sentrix, sage, axion, blackDog, escalationScore: blackDog.score, blockedReason };
}
