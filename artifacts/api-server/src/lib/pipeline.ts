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

const SYSTEM_PROMPT = `You are RSR SCRIBE — an intelligence analyst system that processes real source material and produces structured intelligence outputs.

CRITICAL RULES:
- All analysis must derive directly from the source text provided
- Do NOT invent facts, actors, locations, or scenarios not present in the source
- Do NOT use dramatic generic escalation language unless grounded in the text
- Do NOT include raw URLs in any output field
- Be specific and honest — if evidence is thin, say so
- Use the source hostname for attribution references, not full URLs
- AXION output must be readable social media posts, not intelligence jargon
- If the source is about a niche topic with low risk, assess it honestly — not everything is HIGH risk

You must output valid JSON only.`;

const USER_PROMPT = (
  headline: string,
  body: string,
  sourceHost: string,
  scope: string
) => `HEADLINE: ${headline}
SOURCE: ${sourceHost}
SCOPE: ${scope}

ARTICLE TEXT:
${body}

Analyze the above and produce this JSON structure exactly:

{
  "sentrix": [
    // 4 to 6 signals extracted from the actual article text
    // Each signal must be a distinct meaningful claim, fact, or development
    // Minimum 35 characters per signal text
    // No raw URLs in signal text
    {
      "text": "Direct factual claim from source text (minimum 35 chars, no URLs)",
      "classification": "CONFIRMED | LIKELY | CONTESTED | UNKNOWN",
      "label": "CONFIRMED | LIKELY | CONTESTED | UNKNOWN",
      "confidence": 0-100,
      "kind": "FACT | CLAIM | CHANGE | CONSEQUENCE | DEVELOPMENT"
    }
  ],
  "sage": {
    "WHAT": "Concise description of the core event based only on source text",
    "WHY": "Underlying causes or drivers cited or clearly implied in the source",
    "MECHANISM": "How this is unfolding, the method or process described",
    "CONSTRAINTS": "Factors limiting response or escalation, from source context",
    "CHANGING": "What is shifting or evolving, based on source content",
    "LOCATION": "Geographic locations explicitly mentioned in source (or 'Unspecified')",
    "DOMAIN": "Primary domain: e.g. Cybersecurity, Energy Markets, Geopolitical, Technology, Economic"
  },
  "axion": [
    // 4 to 6 social media post lines
    // Each must stand alone as a clear readable statement
    // No URLs. No hashtags. No emojis.
    // No canned crisis language
    // Derived from source content only
    "Post line 1",
    "Post line 2",
    "Post line 3",
    "Post line 4"
  ],
  "blackDog": {
    "level": "LOW | ELEVATED | HIGH | CRITICAL",
    "reason": "Specific reason based on source content — no generic placeholder text",
    "score": 0-100
  }
}`;

export async function runPipeline(
  headline: string,
  body: string,
  sourceHost: string,
  scope: string,
  logs: string[]
): Promise<PipelineOutput> {
  const empty: PipelineOutput = {
    sentrix: [],
    sage: {
      WHAT: "",
      WHY: "",
      MECHANISM: "",
      CONSTRAINTS: "",
      CHANGING: "",
      LOCATION: "",
      DOMAIN: "",
    },
    axion: [],
    blackDog: { level: "PENDING", reason: "", score: 0 },
    escalationScore: 0,
    blockedReason: "",
  };

  if (!body || body.length < 100) {
    logs.push("[PIPELINE] insufficient source text for analysis");
    return {
      ...empty,
      blockedReason: "Source text too short for analysis",
    };
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
        { role: "user", content: USER_PROMPT(headline, body.slice(0, 3500), sourceHost, scope) },
      ],
    });

    const choice = completion.choices[0];
    const finishReason = choice?.finish_reason;
    raw = choice?.message?.content ?? "";
    if (!raw) {
      logs.push(`[PIPELINE] empty response from model — finish_reason: ${finishReason ?? "none"}`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logs.push(`[PIPELINE] LLM call failed — ${reason}`);
    return { ...empty, blockedReason: `Analysis failed: ${reason}` };
  }

  let parsed: Partial<{
    sentrix: Signal[];
    sage: SageOutput;
    axion: string[];
    blackDog: RiskOutput;
  }>;

  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const jsonStr = cleaned.includes("{") ? cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1) : cleaned;
    parsed = JSON.parse(jsonStr);
  } catch {
    logs.push(`[PIPELINE] JSON parse failed — raw: ${raw.slice(0, 200)}`);
    return { ...empty, blockedReason: "Analysis output could not be parsed" };
  }

  const sentrix = Array.isArray(parsed.sentrix) ? parsed.sentrix.filter((s) => s.text?.length >= 35).slice(0, 8) : [];
  const sage: SageOutput = parsed.sage ?? empty.sage;
  const axion = Array.isArray(parsed.axion) ? parsed.axion.filter((l) => typeof l === "string" && l.length > 0).slice(0, 8) : [];
  const blackDog: RiskOutput = parsed.blackDog ?? { level: "PENDING", reason: "Evaluation incomplete", score: 0 };

  const containsUrls = (text: string) => /https?:\/\//i.test(text) || /www\./i.test(text);
  const cleanAxion = axion.filter((l) => !containsUrls(l));
  const cleanSentrix = sentrix.filter((s) => !containsUrls(s.text));

  logs.push(`[SENTRIX] ${cleanSentrix.length} signals extracted`);
  logs.push(`[SAGE] analysis complete`);
  logs.push(`[AXION] ${cleanAxion.length} deployment lines generated`);
  logs.push(`[BLACK DOG] risk level: ${blackDog.level} (${blackDog.score})`);

  let blockedReason = "";
  if (cleanSentrix.length < 3) {
    blockedReason = `Only ${cleanSentrix.length} meaningful signals extracted — minimum 3 required`;
  } else if (cleanAxion.length < 3) {
    blockedReason = `Only ${cleanAxion.length} clean output lines — minimum 3 required`;
  }

  return {
    sentrix: cleanSentrix,
    sage,
    axion: cleanAxion,
    blackDog,
    escalationScore: blackDog.score,
    blockedReason,
  };
}
