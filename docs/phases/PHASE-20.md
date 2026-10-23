# Phase 20: After the match (v0.6)

> Status: ✅ done (2026-10-23). Approved as part of the roadmap in
> [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md).
> 📘 = verify against official docs, ⚖️ = needs legal review.

Moving from "a match" to "we met", with less burnout along the way.

## 20a. When are you free? (like Hinge's "Direct to Date")

- In a chat, each person can mark the times they're free in the next 14 days (morning, afternoon or
  evening of each day, up to 21 slots).
- **Only the overlap is shown**, never the other person's full list. For example: "You're both free:
  Thursday evening, Saturday morning".
- Tapping an overlap opens the date planner with that day and time filled in.
- The slots are deleted when the chat closes, and 14 days after they've passed.

## 20b. "Did you meet?" and private feedback

- Two hours after an accepted date, the date card asks each person "Did you meet?"
- If yes: "Would you like to see them again?" (yes / not sure / no). The answer is **private**:
  - Only when **both** say yes does the card show "You both want to meet again 💜".
  - Otherwise nothing is shown to the other person.
- "Something felt wrong?" opens the existing report flow (with chat evidence and moderation),
  without saying anything to the other person.
- **"Met in person" badge**: the profile can show "Met someone here in person ✓" once **both**
  people of at least one date confirmed meeting.
  - **Off by default**: the member turns it on in Settings, because it says they've been on a date.
  - It's a trust signal against fake profiles, without biometrics.

## 20c. Focus mode ("your turn")

- When 6 or more people are waiting for **your** reply, Discover asks you to answer them before
  liking anyone new. You can still pass.
- This is against the "many matches, no conversation" burnout, and helps the people waiting.
- Like Hinge's "Your Turn Limits".

## Security and privacy

- Every endpoint checks that the viewer is one of the two people in the match or date (IDOR tests).
- Feedback is never shown to the other person, except the "both want to meet again" signal.
- **Retention and export:**
  - Feedback is deleted with the chat.
  - Availability is deleted when the chat closes, and 14 days after its slots have passed.
  - Both are in "Download my data".
- The badge is a boolean only: no count and no dates.

## Decisions (recommended, approved)

1. Show only the overlap of free times.
2. Feedback is private; only a mutual "again" is revealed.
3. The badge is opt-in.
4. Focus mode starts at 6 waiting replies.

## Results

- Integration tests: `after-match.test.ts` (7): only the overlap is ever returned, slot validation
  and IDOR (404 for outsiders), deletion when the chat closes and after 14 days, "did you meet?"
  only 2 h after an accepted date, private answers with only a mutual "again" revealed, the opt-in
  badge (needs both to confirm), focus mode at 6 waiting. Full suite: **166/166**.
- e2e `pnpm --dir e2e after-match` in en/he/ar/ru, through the UI: free times, overlap chips that
  open the planner with day and hour filled in, a date proposed from there, "did you meet?" with the
  live "you both want to meet again", the badge after turning it on, the "Your turn" card with six
  people waiting. 0 axe violations.
- Screenshots `70-free-times`, `71-free-overlap`, `72-date-feedback`, `73-your-turn`.

## Changes while building

- The chat service now takes the same clock as the date service, so "did you meet?" opens at the
  right moment (and tests can move time).
- Groups of checkboxes are exposed as named groups (`role="group"`), so screen readers announce
  which day the morning/afternoon/evening boxes belong to.
- Found and fixed an older RTL bug: on the web, interface text in the chat and call screens aligned
  left in Hebrew and Arabic, because only the standard screen layout set the text direction. The
  direction is now set once for the whole app.
- The chat hides shared times whose day has already passed in the person's own time zone (the
  server keeps one day of slack for time zones).
