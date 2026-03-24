import { Router, type IRouter } from "express";

const router: IRouter = Router();

const DEMO_CANDIDATES = [
  {
    headline: "Global energy markets react to latest geopolitical tensions in Eastern Europe",
    url: "https://example.com/energy-markets-2026",
    summary: "Crude oil prices surge as diplomatic channels fail to de-escalate border dispute.",
    sourceHost: "reuters.com",
    publishedAt: new Date(Date.now() - 45 * 60000).toISOString(),
    scope: "ENERGY",
    feedName: "Reuters World",
    score: 92,
  },
  {
    headline: "Cyber incident disrupts critical infrastructure across three NATO member states",
    url: "https://example.com/nato-cyber-incident",
    summary: "Coordinated intrusion campaign targets power grid SCADA systems, attribution ongoing.",
    sourceHost: "theguardian.com",
    publishedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    scope: "CYBER",
    feedName: "Guardian Security",
    score: 88,
  },
  {
    headline: "UN Security Council emergency session called over South China Sea incident",
    url: "https://example.com/scs-un-session",
    summary: "Naval standoff prompts emergency diplomatic intervention at highest international level.",
    sourceHost: "apnews.com",
    publishedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    scope: "CONFLICT",
    feedName: "AP World",
    score: 85,
  },
];

const DEMO_SENTRIX = [
  {
    text: "Energy market volatility reaching multi-year highs as geopolitical risk premiums are priced in across all major benchmark contracts.",
    classification: "CONFIRMED",
    label: "CONFIRMED",
    confidence: 91,
    kind: "FACT",
  },
  {
    text: "State-level actors are suspected in the coordinated infrastructure disruption, with forensic indicators pointing to advanced persistent threat groups.",
    classification: "LIKELY",
    label: "LIKELY",
    confidence: 74,
    kind: "CLAIM",
  },
  {
    text: "Diplomatic channels are increasingly strained, with multiple back-channel negotiations reported to have broken down in the past 48 hours.",
    classification: "CONFIRMED",
    label: "CONFIRMED",
    confidence: 83,
    kind: "DEVELOPMENT",
  },
  {
    text: "Secondary economic cascades are forming in currency markets adjacent to the primary conflict zone, with capital flight accelerating.",
    classification: "LIKELY",
    label: "LIKELY",
    confidence: 68,
    kind: "CONSEQUENCE",
  },
  {
    text: "Alliance solidarity mechanisms are being formally invoked, signaling a transition from bilateral to multilateral crisis management.",
    classification: "CONFIRMED",
    label: "CONFIRMED",
    confidence: 89,
    kind: "CHANGE",
  },
];

const DEMO_SAGE = {
  WHAT: "A multi-domain crisis encompassing energy market disruption, cyber infrastructure attacks, and naval confrontation is escalating simultaneously across three strategic theaters.",
  WHY: "Convergence of long-standing territorial disputes, economic pressure from sanctions regimes, and opportunistic exploitation of perceived alliance hesitation.",
  MECHANISM: "State and non-state actors are leveraging asymmetric capabilities — cyberattacks on critical infrastructure, economic pressure through energy markets, and tactical naval provocations — to achieve strategic objectives below the threshold of open armed conflict.",
  CONSTRAINTS: "Nuclear escalation risks, NATO Article 5 obligations, and global economic interdependence constrain full-spectrum kinetic responses from all parties.",
  CHANGING: "The crisis is transitioning from isolated incidents to a coordinated multi-domain pressure campaign, requiring integrated diplomatic, economic, and security responses.",
  LOCATION: "Eastern Europe, South China Sea, North Atlantic maritime zones",
  DOMAIN: "Geopolitical / Security / Energy",
};

const DEMO_AXION = [
  "A coordinated multi-domain pressure campaign is now underway across Eastern Europe, the South China Sea, and North Atlantic maritime zones — simultaneously targeting energy markets, critical cyber infrastructure, and naval force positioning.",
  "State-level actors have deployed asymmetric capabilities below the armed conflict threshold: SCADA intrusions disrupting power grids across three NATO states, orchestrated energy market manipulation driving crude benchmarks to multi-year highs, and tactical naval provocations forcing an emergency UN Security Council session.",
  "The convergence is not coincidental. Intelligence assessments point to deliberate coordination designed to exploit perceived alliance hesitation while economic interdependence constrains full-spectrum kinetic responses.",
  "Secondary cascades are forming. Capital flight is accelerating in affected currency markets, diplomatic back-channels have broken down, and alliance solidarity mechanisms are being formally invoked for the first time since 2022.",
  "The strategic calculus: maximum pressure across multiple domains simultaneously — testing response coherence, degrading alliance unity, and establishing new facts on the ground before diplomatic countermeasures can coalesce.",
];

const DEMO_BLACK_DOG = {
  level: "HIGH",
  reason: "Multi-domain simultaneous escalation with state-level actors operating below armed conflict threshold. Critical infrastructure impact confirmed. Alliance cohesion under active stress.",
  score: 78,
};

router.post("/auto-scan", (req, res) => {
  const { scope, window: windowCode, leadUrl } = req.body as {
    scope?: string;
    window?: string;
    leadUrl?: string;
  };

  const logs = [
    `[AUTO SCAN] mode=AUTO scope=${scope || "GLOBAL"} window=${windowCode || "6H"}`,
    "[FEED] fetching signal candidates from registered sources",
    `[FEED] retrieved ${DEMO_CANDIDATES.length} candidate articles`,
    "[RANK] scoring candidates by signal density, recency, and scope match",
    "[RANK] lead candidate identified",
    "[INGEST] extracting and cleaning source content",
    "[INGEST] content extraction successful",
    "[SENTRIX] running signal classification engine",
    `[SENTRIX] classified ${DEMO_SENTRIX.length} signals`,
    "[SAGE] running analytical framework",
    "[SAGE] framework populated",
    "[AXION] generating output thread",
    `[AXION] thread complete — ${DEMO_AXION.length} posts generated`,
    "[BLACK DOG] running risk evaluation",
    "[BLACK DOG] escalation assessment complete",
    "[SCRIBE] pipeline complete — deployment ready",
  ];

  const leadCandidate = leadUrl
    ? DEMO_CANDIDATES.find((c) => c.url === leadUrl) || DEMO_CANDIDATES[0]
    : DEMO_CANDIDATES[0];

  res.json({
    success: true,
    mode: "AUTO_SCAN",
    scope: scope || "GLOBAL",
    window: windowCode || "6H",
    leadCandidate,
    candidates: DEMO_CANDIDATES,
    sourceRecord: {
      headline: leadCandidate.headline,
      content: leadCandidate.summary,
      timestamp: leadCandidate.publishedAt,
      sourceType: "URL",
      sourceHost: leadCandidate.sourceHost,
      sourceUrl: leadCandidate.url,
      summary: leadCandidate.summary,
      feedName: leadCandidate.feedName,
    },
    cleanedSource: {
      readableText: leadCandidate.summary,
      headline: leadCandidate.headline,
      body: leadCandidate.summary,
      claims: [leadCandidate.summary],
      sourceHost: leadCandidate.sourceHost,
      onlyUrlInput: false,
      extracted: true,
    },
    sentrix: DEMO_SENTRIX,
    sage: DEMO_SAGE,
    axion: DEMO_AXION,
    blackDog: DEMO_BLACK_DOG,
    escalationScore: DEMO_BLACK_DOG.score,
    blockedReason: "",
    logs,
  });
});

export default router;
