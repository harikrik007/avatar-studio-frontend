import { redirect } from "next/navigation";

// The v2 dashboard is one page. Landing on the section root should land on
// it rather than on an index of one item.
export default function DashboardV2Page() {
  redirect("/dashboardv2/agents");
}
