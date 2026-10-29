import AdminBroadcastComposer from './AdminBroadcastComposer.jsx';
import { useAdminAuth } from './AdminGate.jsx';

// The admin team's tools, for every Top 100 official.
const TEAM_TOOLS = [
  { title: 'Appointments', description: 'End-of-season reviews of the bottom three, vacancies and applications.', href: '/appointments', action: 'Open appointments' },
  { title: 'Alerts', description: 'Squad limit, Gold and login alerts.', href: '/alerts', action: 'Open alerts' },
  { title: 'Community Polls', description: 'Create, open, close and finalise manager polls.', href: 'https://vote.smtop100.blog/vote', action: 'Manage polls' },
];

// The platform administrator's own tools; each also checks is_admin itself.
const PLATFORM_TOOLS = [
  { title: 'Manager accounts', description: 'Manage Top 100 manager identities and account lifecycle.', href: 'https://tournaments.smtop100.blog/admin/manager-accounts', action: 'Manage managers' },
  { title: 'Tournament admin', description: 'Run Youth Cup, World Club Cup and other competitions.', href: 'https://tournaments.smtop100.blog/admin', action: 'Tournament admin' },
  { title: 'Soccer Manager sync', description: 'Import Soccer Manager data and diagnostics.', href: 'https://lab.smtop100.blog/sync', action: 'Open sync' },
  { title: 'Result submissions', description: 'Review submitted tournament results.', href: 'https://tournaments.smtop100.blog/admin/result-submissions', action: 'Review results' },
  { title: 'Manager Lab', description: 'Performance and manager analysis tools.', href: 'https://lab.smtop100.blog/', action: 'Open lab' },
  { title: 'Manager Awards', description: 'Awards voting and historical honours.', href: 'https://awards.smtop100.blog/', action: 'Open Awards' },
  { title: 'Publishing Desk', description: 'Write and publish Top 100 stories.', href: 'https://write.smtop100.blog/', action: 'Open publishing' },
];

function ToolGrid({ tools }) {
  return <div className="manager-resource-grid">{tools.map((tool) => <a key={tool.title} className="manager-resource-card" href={tool.href}><strong>{tool.title}</strong><span>{tool.description}</span><span className="muted">{tool.action} →</span></a>)}</div>;
}

export default function AdminControlRoom() {
  const { isGlobalAdmin } = useAdminAuth();
  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Top 100 Admin</p><h1>Control Room</h1><p>One front door for the Top 100 admin team's tools.</p></div></section>
    <section className="manager-resource-hub" aria-labelledby="admin-tools-heading">
      <div className="manager-resource-hub__intro"><p className="eyebrow">Admin team</p><h2 id="admin-tools-heading">Where do you want to go?</h2></div>
      <ToolGrid tools={TEAM_TOOLS} />
    </section>
    {isGlobalAdmin && <section className="manager-resource-hub" aria-labelledby="platform-tools-heading">
      <div className="manager-resource-hub__intro"><p className="eyebrow">Platform administrator</p><h2 id="platform-tools-heading">Your tools</h2><p>Only you can see these.</p></div>
      <ToolGrid tools={PLATFORM_TOOLS} />
    </section>}
    {isGlobalAdmin && <AdminBroadcastComposer />}
  </main>;
}
