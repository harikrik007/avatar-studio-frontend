export type PricingTier = {
  name: string;
  price: string;
  priceNote: string;
  body: string[];
  cta: { label: string; href: string };
  featured?: boolean;
};

// Single source of truth for pricing -- shared by the landing page's
// pricing section and /pricing itself, so they can't drift out of sync.
export const PRICING_TIERS: PricingTier[] = [
  {
    name: "Free",
    price: "$0",
    priceNote: "= 10 credits / mo",
    body: [
      "Create your own avatar from a 6-second video",
      "Automated quality check on every upload",
      "Max 2 minutes / session",
      "Max 1 concurrent session",
      "Preview watermark included",
    ],
    cta: { label: "Get started", href: "/dashboard" },
  },
  {
    name: "Starter",
    price: "$19",
    priceNote: "= 150 credits / mo",
    body: [
      "Everything in Free, plus:",
      "Pay-as-you-go overage",
      "Max 5 minutes / session",
      "Max 5 concurrent sessions",
    ],
    cta: { label: "Get started", href: "/dashboard" },
  },
  {
    name: "Essential",
    price: "$99",
    priceNote: "= 1k credits / mo",
    body: [
      "Everything in Starter, plus:",
      "Pay-as-you-go overage",
      "Max 20 minutes / session",
      "Max 20 concurrent sessions",
      "Watermark removed",
    ],
    cta: { label: "Get started", href: "/dashboard" },
  },
  {
    name: "Business",
    price: "$475",
    priceNote: "= 5k credits / mo",
    body: [
      "Everything in Essential, plus:",
      "Pay-as-you-go overage",
      "Dedicated GPU option (1 included)",
      "Max 60 minutes / session",
      "40 concurrent sessions included",
    ],
    cta: { label: "Get started", href: "/dashboard" },
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    priceNote: "",
    body: [
      "Everything in Business, plus:",
      "Large-scale credit volume",
      "Customizable session length",
      "Starting from 100 concurrent sessions",
      "Dedicated priority support",
    ],
    cta: { label: "Contact sales", href: "mailto:hello@avatar-studio.example" },
  },
];
