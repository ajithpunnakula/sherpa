export interface DemoScenario {
  id: string;
  label: string;
  mode: "discovery" | "demo" | "objection" | "competitive" | "pricing" | "roi" | "followup" | "closing";
  context: string;
}

export const DEMOS: DemoScenario[] = [
  {
    id: "vs-chatgpt",
    label: "Objection · \"Why not just use ChatGPT?\"",
    mode: "objection",
    context:
      "Prospect (Head of Learning at a 600-person engineering org): \"Honestly, why wouldn't we just use ChatGPT? My engineers already have it.\"",
  },
  {
    id: "internal-docs",
    label: "Objection · \"We already use internal docs\"",
    mode: "objection",
    context:
      "Prospect: \"We have a Confluence wiki and a Notion. We already point new hires at it. Why do we need CoffeeAndAI on top?\"",
  },
  {
    id: "expensive",
    label: "Pricing · \"This seems expensive\"",
    mode: "pricing",
    context:
      "Prospect VP Eng on a 50-seat deal: \"The number you quoted is higher than I expected. Talk me through the value.\"",
  },
  {
    id: "discovery-platform",
    label: "Discovery · platform sponsor for AI enablement",
    mode: "discovery",
    context:
      "I'm meeting the new Director of Platform Engineering. They are scoping how to roll out AI tooling across 8 squads. I want to uncover pain, current efforts, decision criteria, and timeline.",
  },
  {
    id: "demo-tutor",
    label: "Demo · AI tutor on a card",
    mode: "demo",
    context:
      "About to show the AI tutor mid-lesson. The buyer cares about onboarding speed and consistency for new hires. What should I show, and how do I narrate it?",
  },
  {
    id: "roi-onboarding",
    label: "ROI · onboarding speed",
    mode: "roi",
    context:
      "Buyer asked how to justify this to their CFO. Hiring 40 engineers next year. Today onboarding takes ~6 weeks. They want a number.",
  },
  {
    id: "followup-after-demo",
    label: "Follow-up · after a strong demo",
    mode: "followup",
    context:
      "Demo went well with the Head of Engineering and the L&D lead. Agreed next step is a 2-week pilot with one squad. They asked for a security overview. I want to send the recap today.",
  },
  {
    id: "close-pilot",
    label: "Close · propose a pilot",
    mode: "closing",
    context:
      "Late-stage call with the buyer. They like it but haven't committed. I want to propose a concrete 2-week pilot scoped to the platform team with a clear success metric.",
  },
];
