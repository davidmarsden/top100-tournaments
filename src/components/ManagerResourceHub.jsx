const RESOURCES = [
  { label: 'Stats & History', description: 'Seasons, managers, honours, records and the statistical story of Top 100.', href: 'https://archive.smtop100.blog/' },
  { label: 'Tournaments', description: 'Youth Cup, World Club Cup, fixtures, tables and competition history.', href: 'https://tournaments.smtop100.blog/' },
  { label: 'Manager Awards', description: 'End-of-season voting, Hall of Fame, manager cabinets and Awards history.', href: 'https://awards.smtop100.blog/' },
  { label: 'Community Polls', description: 'Vote on game-world decisions and read the published results.', href: 'https://vote.smtop100.blog/' },
  { label: 'Search & Categories', description: 'Find more than a decade of manager-written Top 100 stories.', href: 'https://smtop100.blog/explore/' },
  { label: 'Write for Top 100', description: 'Submit club news, reports and features to the community.', href: 'https://write.smtop100.blog/' },
  { label: 'Subscribe', description: 'Get new Top 100 posts by email. Manager accounts can also opt in to Youth Cup fixture reminders here in the portal.', href: 'https://smtop100.blog/subscribe/' },
  { label: 'Support', description: 'Help with the site, accounts, submissions and keeping Top 100 running.', href: 'https://smtop100.blog/support/' },
];

export default function ManagerResourceHub() {
  return (
    <section className="manager-resource-hub" aria-labelledby="manager-resource-heading">
      <div className="manager-resource-hub__intro">
        <p className="eyebrow">Manager resources</p>
        <h2 id="manager-resource-heading">Everything around the game world</h2>
        <p>These resources stay public. A Manager Portal account adds personal tools such as Youth Cup fixture reminders, voting and manager-only actions.</p>
      </div>
      <div className="manager-resource-grid">
        {RESOURCES.map((resource) => (
          <a key={resource.label} className="manager-resource-card" href={resource.href}>
            <strong>{resource.label}</strong>
            <span>{resource.description}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
