# Top 100 officials (admin team)

`top100_officials` lists the managers on the Top 100 admin team. `is_top100_official()` is true for them and for platform administrators.

Officials can:

- open tournaments.smtop100.blog/admin/alerts, signing in with their normal Manager Portal account: squad limit breaches, ruling follow-up (bans, required sales), Gold and logins;
- uphold or dismiss breaches, exclude players from the squad count, record bans and required sales, confirm the Gold and login fields, and mark alerts as seen;
- receive every compliance, Gold and login alert as a Top 100 app notification (`top100_official_accounts()`).

Officials are deliberately **not** platform administrators (`is_admin()`). They do not get Soccer Manager Sync approval, data maintenance, tournament administration or Manager Lab, which holds private analysis of every club. Several officials manage rival clubs.

First officials (October 2026): David Marsden, Regan Thompson (Hertha BSC), Hugo Costa (Celtic), Chris Meida (CSKA Moskva). To add one, insert their `managers.id` into `top100_officials`. They need an active, linked Manager Portal account.

## Player transfer bans

Each player's own Soccer Manager transfer ban is in the synced squad (`sourceFields.tban`, `sourceFields.tb`, and `sourceFields.tbraw` as Unix time). A player is banned for a week after a deal with a club outside Top 100 and for a month after a deal with a Top 100 club. The alerts page shows, for each required sale, the date the player can be sold, and highlights sales still outstanding after that date.
