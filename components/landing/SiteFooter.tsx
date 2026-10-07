import Link from "next/link";

/**
 * Footer for the landing and pricing pages. Privacy and Terms are not linked yet: those pages do not exist, and a link to nothing is
 * worse than none. Add them (and a real contact address) here when they do.
 */
export default function SiteFooter() {
  return (
    <footer className="lh-footer">
      <span>© {new Date().getFullYear()} Avatar Studio</span>
      <nav aria-label="Footer">
        <Link href="/#how">How it works</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/#faq">FAQ</Link>
        <Link href="/login?next=/dashboardv2">Sign in</Link>
      </nav>
    </footer>
  );
}
