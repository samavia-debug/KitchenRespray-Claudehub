import SiteDashboard from "./site-dashboard";

export default function WebsiteDetailPage({ params }: { params: { id: string } }) {
  return <SiteDashboard websiteId={params.id} />;
}
