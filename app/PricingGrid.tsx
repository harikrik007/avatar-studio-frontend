import Link from "next/link";
import { PRICING_TIERS } from "./pricing-data";

export default function PricingGrid() {
  return (
    <div className="l-pricing-grid l-cols-5">
      {PRICING_TIERS.map((tier) => (
        <div className={`l-price-card${tier.featured ? " l-featured" : ""}`} key={tier.name}>
          <h3>{tier.name}</h3>
          <div className="l-price">{tier.price}</div>
          {tier.priceNote ? <div className="l-price-note">{tier.priceNote}</div> : <div className="l-price-note">&nbsp;</div>}
          <ul>
            {tier.body.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {tier.cta.href.startsWith("mailto:") ? (
            <a href={tier.cta.href} className="l-btn l-btn-ghost" style={{ width: "100%" }}>
              {tier.cta.label}
            </a>
          ) : (
            <Link
              href={tier.cta.href}
              className={`l-btn ${tier.featured ? "l-btn-primary" : "l-btn-ghost"}`}
              style={{ width: "100%" }}
            >
              {tier.cta.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
