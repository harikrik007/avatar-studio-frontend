/**
 * Words and facts on the landing page and the pricing page, in one place so the two cannot drift apart.
 *
 * Every claim here is something the product does today (checked against the builder, widget.js and the voice catalogue):
 * 34 voices, 10 of them Indian-English accents (lib/voices.ts); knowledge files of up to 20 per agent, 10 MB each
 * (api/main.py); the embed allow-list and the offline switch (the Embed and Advanced tabs); the usage page. No speed, uptime,
 * language-count or "nothing is stored" claims until they are measured or checked. No names of technology vendors, and never the
 * avatar provider. See results/landing-redesign/PLAN.md.
 */

export const HEADLINE = "Put a talking virtual human on your website.";
export const SUBHEAD = "Pick a face and a voice, teach it your business, and add one line of code. Visitors talk to it face to face, in their own words.";

export const NAV_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export const HERO_CHECKS = ["Try it here, no signup", "Added with one line of code", "Pay by the minute"];

export const FACTS = [
  { value: "1 line", label: "of code puts it on your site" },
  { value: "34 voices", label: "10 of them with Indian-English accents" },
  { value: "20 files", label: "of your own documents it can learn from" },
  { value: "By the minute", label: "you pay for talk time" },
];

export const STEPS = [
  {
    label: "Step 1",
    title: "Choose a face and a voice",
    body: "Browse the ready-made faces, listen to the voices before you pick one, and see your agent in the preview as you go.",
    points: ["34 voices to preview, including Indian-English accents", "Show it as a card, or float the avatar on your page with no box"],
    alt: "The builder's Avatar tab: a grid of faces with one selected and a live preview on the right",
  },
  {
    label: "Step 2",
    title: "Teach it your business",
    body: "Write what it should say and do, give it an opening line, and upload your documents. Connect tools so it can act for you.",
    points: ["PDF, Word, text, Markdown and CSV files", "Test it with a real call before anyone else sees it"],
    alt: "The builder's Prompt tab: agent name, opening line, system prompt and an uploaded knowledge file",
  },
  {
    label: "Step 3",
    title: "Go live with one line",
    body: "Copy one line into your site. Only the websites you list can show your agent, and you can take it offline in one click.",
    points: ["Your install line stays the same when you go offline and back", "Every call appears on your usage page, in minutes"],
    alt: "The builder's Embed tab: the one-line install snippet and the list of websites allowed to show the agent",
  },
];

export const EMBED_LAYOUTS = [
  { id: "panel", label: "Panel", body: "A small avatar waits in the corner. A visitor clicks it and it opens into a call on a card, with the conversation beside it." },
  { id: "frameless", label: "Frameless", body: "The avatar floats on your page with no box around it, with what it says in a bubble beside it. It needs a green-screen face." },
];

export const CLIENT_TOOL_SNIPPET = `AvatarStudio.registerToolHandler("open_booking_form", ({ date }) => {
  openBookingModal(date);
  return { ok: true };
});`;

export const CAPABILITIES = [
  { icon: "talk", title: "Talks and listens, live", body: "A video face and a natural voice. Visitors speak, it answers, and they can interrupt it at any point." },
  { icon: "docs", title: "Knows your business", body: "Upload PDF, Word, text, Markdown or CSV files. It answers from them: up to 20 files of 10 MB each." },
  { icon: "bolt", title: "Takes actions", body: "Call your own system, run code on your page, or end the call. You tell it when to use each tool." },
  { icon: "voice", title: "Sounds like your customers", body: "34 voices to preview, 10 of them with Indian-English accents." },
  { icon: "frame", title: "Looks like it belongs", body: "Show it as a card, or float the avatar on your page. Choose your accent colour and the greeting it shows." },
  { icon: "shield", title: "Stays in your control", body: "Only the sites you list can show it, with built-in limits on calls at once and per hour. A usage page shows every call." },
] as const;

export type UseCase = {
  id: string;
  label: string;
  /** words that match a persona's role, so the tab can offer that persona's live call */
  match: string[];
  outcome: string;
  visitor: string;
  agent: string;
};

export const USE_CASES: UseCase[] = [
  {
    id: "sales", label: "Sales", match: ["sales"],
    outcome: "Answers product questions, qualifies the visitor and books the next step.",
    visitor: "Does the Pro plan include onboarding?",
    agent: "It does. A specialist walks your team through setup in the first week. Want me to book a time?",
  },
  {
    id: "support", label: "Support", match: ["support", "service", "help"],
    outcome: "Handles the common questions at any hour and hands over when it should.",
    visitor: "Where is my order?",
    agent: "I can check that for you. What's your order number?",
  },
  {
    id: "front-desk", label: "Front desk", match: ["front desk", "reception", "concierge", "host"],
    outcome: "Greets visitors, answers where and when, and points them to the right place.",
    visitor: "Are you open on Sunday?",
    agent: "We open at ten on Sundays. Would you like directions from where you are?",
  },
  {
    id: "training", label: "Training", match: ["train", "tutor", "coach", "teacher", "trainer"],
    outcome: "Plays the customer, the patient or the interviewer, so people can practise.",
    visitor: "I'd like to return this, please.",
    agent: "Of course. Can you tell me what's wrong with it?",
  },
  {
    id: "events", label: "Events", match: ["event", "guide"],
    outcome: "Walks attendees through the schedule, the speakers and the venue.",
    visitor: "What's on at two o'clock?",
    agent: "Two sessions: a keynote in Hall A and a workshop in Room 3. Which sounds better?",
  },
];

export const CONTROL = [
  { title: "Your sites only", body: "You list the websites that may show your agent. No other site can load it." },
  { title: "Built-in limits", body: "Limits on calls at once and per hour keep a busy day from running away." },
  { title: "Every minute visible", body: "A usage page lists each call, how long it ran and how it ended." },
  { title: "Offline in one click", body: "Take an agent offline and it stops answering. Your install line stays where it is." },
  { title: "The microphone, on request", body: "It is used only during a call the visitor starts, and the browser asks first." },
];

export const PRICING_POINTS = [
  { title: "Try it", body: "Talk to the demo agent on this page. No signup, no card." },
  { title: "Build it", body: "Creating an agent costs nothing. Choose its face and voice, write its instructions, add your documents." },
  { title: "Pay for talk time", body: "You pay for the minutes your agent is in conversation. A usage page shows every call as it happens." },
];

export const PRICING_NOTE = "Monthly plans with minutes included are on the way.";

export const FAQS = [
  { q: "What is a talking virtual human?", a: "A video agent that lives on your website. It has a face and a voice, it listens to your visitor, and it answers out loud using the instructions and documents you gave it." },
  { q: "What does a visitor need?", a: "A modern browser, a microphone and speakers. There is nothing to install, and the browser asks for permission before it uses the microphone." },
  { q: "How do I add it to my site?", a: "Paste one line of code before the closing body tag, then list your website's address in the Embed tab. The agent appears as a small avatar in the corner of the page." },
  { q: "What can it do besides talk?", a: "It can call your own system to look something up or book something, run code on your page such as opening a form, and end the call when the conversation is over." },
  { q: "Can I choose how it sounds?", a: "Yes. There are 34 voices you can preview before you pick one, and 10 of them have an Indian-English accent." },
  { q: "Can it use my own documents?", a: "Yes. Upload PDF, Word, text, Markdown or CSV files, up to 20 per agent and 10 MB each, and it answers from them." },
  { q: "How is it billed?", a: "By the minutes your agent spends talking. Creating an agent is free, and the usage page shows each call. Monthly plans with minutes included are on the way." },
  { q: "Is it safe to put on my site?", a: "Only the websites you list can show your agent, and there are built-in limits on how many calls run at once and per hour. You can take it offline at any time." },
  { q: "Can I try it before I build one?", a: "Yes. Talk to the demo agent at the top of this page with no signup. When you build your own, you can test it with a real call before it goes live." },
];
