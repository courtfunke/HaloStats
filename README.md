# Fireteam Stats: Halo MCC dashboard

A free dashboard on GitHub Pages that tracks Halo: The Master Chief Collection stats for:

**Battle Cheese · RufusKrayola01 · Puddup · The True Bruno · Skylord Paul**

Every 2 hours a GitHub Action signs in to Halo Waypoint, pulls each player's service record and recent matches, and saves new matches into `data/`. The Halo API only keeps your last ~100 matches, so this saved history keeps growing past that limit from the day you set it up.

**The dashboard shows:** lifetime service records, a sortable leaderboard (K/D, KDA, win %, kills/deaths/headshots per game, best game, streaks), a rolling K/D trend chart, each player's K/D per Halo game, a squad grid (games played together and the win rate when you do), and a recent-matches feed. You can filter by game and by date range.

Want to see it before setting anything up? Once it's deployed, add `?demo` to the URL to see it with sample data.

> ⚠️ This uses the same unofficial endpoints the Halo Waypoint website uses (`mccapi.svc.halowaypoint.com`). It isn't a supported public API, so it may break if Microsoft changes things.

---

## Setup (about 15 minutes, one time)

You need a GitHub account, the Microsoft account you use on Xbox, and [Node.js 18+](https://nodejs.org) on your computer for step 3.

### 1. Put this folder on GitHub

1. Create a new repository on GitHub (e.g. `halo-stats`). It can be public or private, but **GitHub Pages on a free account requires a public repo**.
2. Upload these files to it, either by dragging the folder contents into GitHub's "uploading an existing file" page or with git:
   ```bash
   cd halo-mcc-dashboard
   git init && git add . && git commit -m "Halo stats dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/halo-stats.git
   git push -u origin main
   ```
   If you drag and drop, make sure the hidden `.github` folder gets uploaded too. The workflow file lives there.

### 2. Register a free Azure app (so the bot can sign in to Xbox Live)

1. Go to <https://portal.azure.com> and sign in with your Microsoft account. If it asks, create a free Azure account (no charges are needed for this).
2. Search for **App registrations** → **New registration**.
   - Name: `Halo Stats Dashboard`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: leave blank
   - Click **Register**.
3. On the app's **Overview** page, copy the **Application (client) ID**.
4. Go to **Authentication** → scroll to **Advanced settings** → set **Allow public client flows** to **Yes** → **Save**.

### 3. Sign in once and save the secrets

On your computer, in this folder:

```bash
node scripts/login.mjs YOUR-CLIENT-ID
```

It prints a code. Open the link, enter the code, and sign in with your Xbox Microsoft account. The script then checks that Halo Waypoint accepts the sign-in and that it can read Battle Cheese's stats.

Next, in your GitHub repo go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | the Application (client) ID from step 2 |
| `XBOX_REFRESH_TOKEN` | the contents of `.refresh-token.txt` (then delete that file) |

*Shortcut:* if you have the [GitHub CLI](https://cli.github.com) installed and logged in, run `node scripts/login.mjs YOUR-CLIENT-ID --set-secrets` from inside the repo folder and it sets both secrets for you.

### 4. Keep the sign-in fresh (recommended)

Microsoft gives the bot a new sign-in token every time it runs. To save it automatically so you never have to log in again:

1. Create a fine-grained token at <https://github.com/settings/personal-access-tokens/new>.
   - Repository access: **Only select repositories** → your stats repo
   - Permissions → Repository → **Secrets: Read and write**
2. Add it as a repository secret named `GH_PAT`.

Without this, the bot keeps using your original sign-in, which Microsoft may expire after about 90 days. If that happens the workflow fails, and you rerun step 3.

### 5. Turn on GitHub Pages

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Go to the **Actions** tab → **Update Halo stats** → **Run workflow**.
3. When it finishes, your dashboard is at `https://YOUR-NAME.github.io/halo-stats/`.

After that it updates itself every 2 hours.

---

## Changing things

- **Add or remove players:** edit the `players` list in `config.json`. Colors follow the order in this list.
- **Rename the dashboard:** change `title` in `config.json`.
- **Update more or less often:** edit the `cron` line in `.github/workflows/update-stats.yml` (e.g. `'17 * * * *'` for hourly).

## Troubleshooting

- **Workflow fails with "Microsoft token refresh failed":** the sign-in expired. Rerun step 3 and update `XBOX_REFRESH_TOKEN` (or set up step 4 so this doesn't happen).
- **XSTS error mentioning "child account" or "no Xbox profile":** sign in with an adult account that has an Xbox profile.
- **One player shows "Not authorized" or "not found":** check the gamertag spelling in `config.json`. Their Xbox privacy settings may also hide their game history; on Xbox, *Settings → Account → Privacy & online safety → Xbox privacy → View details & customize → Game content → Others can see your game and app history* should be *Everyone*.
- **Squad numbers look off:** the Halo API doesn't say who was in which game, so the dashboard matches games by start time (within 2 minutes) and identical game length. Treat it as a close estimate.
- **Scheduled runs stopped:** GitHub pauses scheduled workflows in repos with no activity for 60 days. The bot's own data commits normally count as activity, but if it pauses, re-enable it from the Actions tab.

## What's in here

```
index.html, assets/        the dashboard (plain HTML/JS, Chart.js from a CDN)
config.json                players + title
data/                      saved stats (written by the workflow)
demo/                      sample data for ?demo
scripts/login.mjs          one-time sign-in helper
scripts/fetch-stats.mjs    the stats puller the workflow runs
scripts/lib/halo.mjs       Xbox Live → Halo Waypoint auth + MCC API calls
.github/workflows/         schedule + GitHub Pages deploy
```

Unofficial fan project, not affiliated with Microsoft, Halo Studios or 343 Industries.
