# Akademi Ragbi Melaka — Player Selection Portal

A static, GitHub-Pages-friendly player roster site with:
- Search + filter by age group and unit
- Public cards (name, nickname, photo, position, age) — visible to anyone
- A "+" on each card that opens the full profile (medical history, IC,
  guardian contacts, etc.) — locked behind either:
  - **Coach/Admin password** — one shared password, sees any player
  - **Parent access** — enter your child's IC number, see only that child

No backend, no database server. Everything runs from static files, and the
sensitive data is genuinely encrypted (not just hidden by the interface) —
see "How the security works" below.

## Folder structure

```
akram-portal/
├── build.py              ← run this whenever the spreadsheet changes
├── roster.xlsx            ← (you keep your own copy; not in this repo)
├── README.md
└── docs/                  ← this is what gets deployed / pushed to GitHub Pages
    ├── index.html
    ├── style.css
    ├── app.js
    └── data/
        ├── cards.json          ← public, safe to be world-readable
        ├── admin.enc.json      ← encrypted, needs admin password
        ├── players/*.json      ← encrypted, needs each player's IC
        └── photos/*.jpg        ← you add these yourself (see below)
```

## First-time setup

1. Install the one Python dependency:
   ```
   pip install pandas openpyxl cryptography
   ```

2. Run the build script, pointing it at your Excel file:
   ```
   python3 build.py roster.xlsx
   ```
   It will ask you to set an admin password — this is the password
   coaches/staff will use. **It is never written into any file**, so
   it's safe to commit `docs/` to a public GitHub repo.

3. Add player photos to `docs/data/photos/`. Each file must be named to
   match the player's `id`, which you can see in `docs/data/cards.json`
   (it's their name in lowercase-with-dashes, e.g.
   `aiman-zaini-bin-zainal.jpg`). If a photo is missing, the card just
   shows a blank placeholder — nothing breaks.

4. Preview locally before deploying:
   ```
   cd docs
   python3 -m http.server 8000
   ```
   Then open http://localhost:8000 in your browser.

## Whenever you update the spreadsheet

Just hand-edit the Excel file as you've been doing, then re-run:
```
python3 build.py roster.xlsx
```
You'll be asked for the admin password again — **use the same one** you
set originally, so coaches don't need a new password. This regenerates
all the data files. Commit and push `docs/` and the live site updates.

> Tip: the build script will print warnings if it spots things like
> duplicate IC numbers or malformed ICs — don't ignore these, they mean
> a player record needs a manual check.

## Deploying to GitHub Pages

1. Push this whole folder to a GitHub repo.
2. In the repo settings → Pages, set the source to the `docs/` folder
   on your main branch.
3. Your site will be live at `https://<username>.github.io/<repo>/`.

Because everything is static files, there's nothing else to configure —
no server, no environment variables, no database credentials.

## How the security works (and its real limits)

This is a static site, which means anything downloaded to a browser can,
in principle, be inspected by that browser's user. A password *field* in
JavaScript alone wouldn't actually protect anything — someone could open
dev tools and just read the data. So instead, the data itself is
encrypted:

- **`admin.enc.json`** contains the entire roster, encrypted with the
  admin password using AES-256. Nobody can read any part of it without
  that password — including via "view source."
- **Each player's file** in `data/players/` is separately encrypted using
  *that specific child's IC number* as the encryption key. A parent who
  enters their child's IC can only ever unlock that one file — not
  because of a permissions check, but because they simply don't have the
  key to unlock anyone else's.

**Honest limitation:** IC numbers aren't fully random (they encode date
of birth and place of birth), so a child's own IC is a weaker key than a
proper random password. Someone who specifically targeted one child with
automated guessing could theoretically narrow it down. For a
coaches-and-parents portal, this is a reasonable trade-off between
security and staying simple/static. If this ever needs to protect more
sensitive data at a larger scale, a real authenticated backend would be
the next step — this setup is not that.

**Also worth knowing:** anyone can see the *public* card info (name,
photo, position, age group) without any password — that part is by
design, matching how the portal is meant to work as a public-facing
selection page. Only the "+" detail view is protected.
