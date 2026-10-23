# Phase 19: Profile depth (v0.6)

> Status: ✅ done (2026-10-22). Approved as part of the roadmap in
> [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md) ("everything, one after the other").
> 📘 = verify against official docs, ⚖️ = needs legal review.

The gap members feel first: "I can't tell who smokes or wants children, or what we have in common."
Everything here is optional, and nothing is shown that the member didn't fill in.

## 19a. About me: interests and lifestyle

- **Interests**: up to 10 from a fixed list of 40 (hiking, cooking, board games…), translated into
  the 4 languages. A fixed list (not free text) keeps it searchable, translatable and free of
  abuse.
- **Lifestyle**, each optional:
  - Children: have and want more, have and don't want more, want, don't want, open.
  - Smoking: no, sometimes, yes.
  - Drinking: no, socially, often.
  - Height (120–230 cm).
- **Religious observance** (not religious, traditional, religious, very religious, spiritual):
  - Special-category data (GDPR Art. 9; sensitive under the Israeli law) ⚖️.
  - Stored only with its own explicit consent, `religion`, given in the same screen.
  - Withdrawing the consent deletes the answer and the related filter.
- **Shown on the profile** as chips. The "why you might click" list gains "You both like …" for
  shared interests, and shared interests add a small bonus to the ranking.

## 19b. Dealbreakers

- In Preferences, optional filters:
  - Smoking: which answers are fine.
  - Children: which answers are fine.
  - Height range.
  - Religious observance (needs the consent).
- **Both directions**, like every other preference: you see someone only if each of you fits the
  other's filters.
- **No answer passes**, so leaving a field empty is never a penalty (stated in the screen).
- Implemented in the single visibility query (`candidateSql`).

## 19c. Opening question

- One question the member wants matches to answer, either chosen from suggestions or written
  (≤140 characters, through the same text filters as messages).
- **Shown on the profile**, and in a new chat as "Answer {name}'s question".

## 19d. Voice prompt

- One voice answer (≤30 s) to a prompt, recorded in the app.
- It goes through the existing audio pipeline: ClamAV, re-encoding, metadata stripped (including
  the Ogg stream tags fixed in phase 16).
- It's played only to people who can see the profile.
- No speech-to-text on the server.

## Security, privacy, accessibility

- **Validation:**
  - Server-side zod schemas against the fixed lists.
  - The opening question goes through the offensive-text filter.
- **Access:** the voice prompt and the about-me fields are shown only through the visibility rules
  (IDOR tests).
- **Export and deletion:** every field is in "Download my data" and is deleted with the account.
- **Accessibility:** chips are checkboxes or radio buttons with labels, the height picker is a
  stepper with a text alternative, and voice prompts have a play button with a duration label.
  Tested in 4 languages, RTL and at 200% text.

## Decisions (recommended, approved)

1. Fixed lists rather than free text, for interests and lifestyle.
2. Religious observance is optional, with its own consent.
3. A missing answer passes the filters.
4. Up to 10 interests and one voice prompt.

## Results

| Check                                  | Result                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration (`about.test.ts`, 6 tests) | ✅ save and show; shared interests rank with a reason; validation (fixed lists, 10 interests, height, offensive question); dealbreakers both ways, a missing answer passes; religion only with its consent, withdrawn → deleted with its filter; voice prompt ≤30 s, played only to people who can see the profile, replaced and deleted, hidden until clean |
| `pnpm --dir e2e about`                 | ✅ 4 languages: About me in the app, a voice prompt recorded with a fake microphone and processed by the worker, dealbreakers, the other member sees the chips (✓ shared), the question and the voice prompt; a smoker is hidden; 0 axe violations                                                                                                           |
| Screenshots                            | `67-about-edit`, `68-about-profile`, `69-dealbreakers` in 4 languages                                                                                                                                                                                                                                                                                        |

## Changes while building

- The voice prompt schemas live next to the prompts (`profile.ts`): importing them from `about.ts`
  made a circular import that left a schema undefined at runtime (caught by the integration test).
- Saving About me or Dealbreakers goes to the profile or settings when there's no screen to go back to
  (opened from a link).
