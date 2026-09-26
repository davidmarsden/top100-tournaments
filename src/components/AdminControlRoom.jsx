const TOOLS = [
  { title: 'Community Polls', description: 'Create, open, close and finalise manager polls.', href: 'https://vote.smtop100.blog/vote', action: 'Manage polls' },
  { title: 'Manager accounts', description: 'Manage Top 100 manager identities and account lifecycle.', href: 'https://tournaments.smtop100.blog/admin/manager-accounts', action: 'Manage managers' },
  { title: 'Tournament admin', description: 'Run Youth Cup, World Club Cup and other competitions.', href: 'https://tournaments.smtop100.blog/admin', action: 'Tournament admin' },
  { title: 'Soccer Manager sync', description: 'Import Soccer Manager data and diagnostics.', href: 'https://tournaments.smtop100.blog/admin/soccer-manager-sync', action: 'Open sync' },
  { title: 'Result submissions', description: 'Review submitted tournament results.', href: 'https://tournaments.smtop100.blog/admin/result-submissions', action: 'Review results' },
  { title: 'Manager Lab', description: 'Performance and manager analysis tools.', href: 'https://tournaments.smtop100.blog/admin/manager-lab', action: 'Open lab' },
  { title: 'Manager Awards', description: 'Awards voting and historical honours.', href: 'https://awards.smtop100.blog/', action: 'Open Awards' },
  { title: 'Publishing Desk', description: 'Write and publish Top 100 stories.', href: 'https://write.smtop100.blog/', action: 'Open publishing' },
];

export default function AdminControlRoom() {
  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Top 100 Admin</p><h1>Control Room</h1><p>One front door for the tools scattered across the Top 100 network.</p></div></section>
    <section className="manager-resource-hub" aria-labelledby="admin-tools-heading">
      <div className="manager-resource-hub__intro"><p className="eyebrow">Admin tools</p><h2 id="admin-tools-heading">Where do you want to go?</h2><p>This page links to the existing admin tools rather than duplicating them.</p></div>
      <div className="manager-resource-grid">{TOOLS.map((tool) => <a key={tool.title} className="manager-resource-card" href={tool.href}><strong>{tool.title}</strong><span>{tool.description}</span><span className="muted">{tool.action} →</span></a>)}</div>
    </section>
  </main>;
}