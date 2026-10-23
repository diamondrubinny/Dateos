# Phase 25: Easy mode and accessibility needs (v1.1)

> Status: ✅ done (2026-10-23). Approved as "continue with everything needed": the next open
> gap in [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md) §3 (items 5 and 6).
> 📘 = verify against official docs, ⚖️ = needs legal review.

Two things almost no dating app does, both listed in the competitive analysis as wanted and
unserved:

- **An easy mode** for people 50+ and anyone less at home with apps: bigger text, bigger buttons,
  fewer tabs and menus, plain words.
- **Accessibility needs, shared by choice**: someone who uses a wheelchair, is deaf or hard of
  hearing, or prefers to text before a call can say so once, and the app helps (step-free places,
  captions, "texts first") without anyone else being able to filter them out.

## 25a. Display and ease of use (on this device)

A new screen, **Settings → Display and ease of use** (`/display`), also offered on the welcome
screen before sign-up ("Bigger text and a simpler app"):

| Setting         | Values                                   | Effect                                                                                                                                                                                                          |
| --------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text size       | Standard / Large (×1.25) / Larger (×1.5) | Every text in the app scales, on top of the system's own text size (still capped so layouts hold at 200% zoom).                                                                                                 |
| Easy mode       | off / on                                 | 3 tabs instead of 5 (Discover, Chats, Me; Picks and Likes stay reachable from Discover), larger buttons (56 px), a shorter "Me" and Settings with "More options" folded, a short explanation under each action. |
| Higher contrast | off / on                                 | Muted text and borders use full-contrast colors (WCAG AAA for body text where the palette allows).                                                                                                              |
| Reduce motion   | follow the system / always               | The match celebration and other animations are skipped.                                                                                                                                                         |

- Stored **on the device only** (`nexaheart.display`, listed on the cookies page as "remembers a
  choice you made"). Nothing is sent to the server: no one learns who chose easy mode.
- Applied app-wide through one `DisplayProvider` (text scale in `AppText`, sizes in `Button`, tabs,
  theme colors).

## 25b. Accessibility needs on the profile (optional, by consent)

- **Edit profile → Accessibility** (`/access-needs`). Choose any of:
  `wheelchair` (uses a wheelchair), `step_free` (needs step-free places), `deaf_hoh` (deaf or hard
  of hearing), `blind_low_vision` (blind or low vision), `sign_language` (signs),
  `text_first` (prefers texting before a call), `quiet_places` (prefers quiet places).
- **This can reveal health information** (GDPR Art. 9; "sensitive" under Israel's Privacy
  Protection Law) ⚖️. So:
  - stored only with a new explicit consent `accessibility` (versioned text, like `religion`);
    withdrawing it deletes the answers at once;
  - **two separate choices**: "Use these to help me" (private: only the member's own app uses them)
    and "Show them on my profile" (off by default);
  - **never used for ranking, never a filter for others**, never sent to an AI model, not shown to
    moderators (the member's own data export includes them).
- What it does:
  - **Date planner**: with `wheelchair` or `step_free` (own, or the other person's shown needs),
    step-free places come first and a "Step-free only" switch starts on.
  - **Calls**: with `deaf_hoh`, live captions start on by themselves (on-device, as in phase 16c).
    If the other person shows `text_first`, the call button says so before calling.
  - **Profile card**: shown needs appear as a short line ("♿ Uses a wheelchair · Prefers texting
    first"), read as one sentence by screen readers.

## API (changed)

| Method | Path                        | Who    | Change                                                                                 |
| ------ | --------------------------- | ------ | -------------------------------------------------------------------------------------- |
| GET    | `/v1/me`                    | member | adds `accessNeeds: { needs, show }`                                                    |
| PUT    | `/v1/me/access-needs`       | member | new; `{ needs: AccessNeed[], show: boolean }`; 403 without the `accessibility` consent |
| PUT    | `/v1/me/consents`           | member | withdrawing `accessibility` clears the needs                                           |
| GET    | discovery, matches, profile | member | the other person's needs **only when they chose to show them**                         |

## Data (new)

- `profile_about.access_needs text[] not null default '{}'` and `profile_about.show_access_needs
boolean not null default false`, next to religious observance; a new consent kind
  `accessibility` (migration `0029_access_needs`).
- Data map (PRIVACY.md): purpose "help with the member's own dates and calls; shown only if the
  member chooses", basis explicit consent (Art. 9(2)(a)), kept until changed, consent withdrawn or
  the account is deleted; in "Download my data".

## Security and privacy

- Server-side checks: no consent → 403 and nothing stored; the list is validated (`z.enum`, unique,
  at most 7); other members get the needs only with `show = true`, in every response that carries a
  profile (one shared serializer).
- No logging of the values; the audit trail for staff never includes them.
- Display preferences never leave the device.

## Accessibility

- Every new screen: headings, labels, keyboard and screen reader checks, 200% zoom, RTL in all 4
  languages, axe 0 violations (e2e).
- Easy mode itself is checked with axe in Hebrew and English.

## Order of work

1. shared: `accessNeeds`, consent kind, schemas; db migration.
2. API: `/v1/me/access-needs`, consent withdrawal, the shared profile serializer; tests.
3. Mobile: `DisplayProvider` + `/display` + welcome toggle; easy mode tabs and menus.
4. Mobile: `/access-needs`, profile card line, date planner, calls.
5. i18n (en, he, ar, ru), docs (PRIVACY, accessibility statement, CHANGELOG, README).
6. e2e (`pnpm --dir e2e easy`): screenshots, axe, all languages. PR, CI, merge.

## Results

- **Built:**
  - `/display` (also linked from the welcome page and Settings): text size (×1, ×1.25, ×1.5 on top
    of the system size), easy mode, higher contrast, reduced motion. Stored only on the device
    (`nexaheart.display`, listed in the cookie policy and on the cookies page).
  - Easy mode: three tabs (Picks and Likes become buttons on Discover), 56 px buttons, a plain
    explanation under Like and Pass, a confirmation after each like, and "More options" folding the
    less-used items on the Me tab and in Settings. Animations follow the choice and the system.
  - `/access-needs`: consent, seven needs, "show on my profile". The date planner starts with
    "Step-free places only" when either person needs it; captions start by themselves for someone
    deaf or hard of hearing; the call menu says when the other person prefers texting first.
- **Tests:**
  - Integration: 4 new (needs the consent and a current version, validation, shown only when chosen,
    kept when About me is edited, deleted when the consent is withdrawn, in the export).
  - Unit: reading the stored display settings defensively.
  - e2e `pnpm --dir e2e easy`: all 4 languages; 6 screenshots each (`93-welcome-easy`,
    `94-display`, `95-discover-easy`, `96-access-needs`, `97-profile-access-needs`,
    `98-date-step-free`); axe: 0 WCAG 2.1 AA violations.
- **Found and fixed while building:** the plan put the columns on `profiles`; they live with the
  other special-category answers in `profile_about`, so About me edits and consent withdrawal stay in
  one place.
- **Still to check:**
  - ⚖️ Accessibility needs can reveal health data: the consent text, and whether showing them on
    the profile needs anything more where you operate.
  - 📘 Text scaling and easy mode on real iOS and Android devices with the system's largest text
    sizes; automatic captions on native.
  - A manual review with screen readers, and with people 50+ who use the app for the first time.
