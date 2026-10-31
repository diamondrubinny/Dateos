# Phase 71c: Help during an event, a Hebrew date, and sharing an event (v1.53)

> Status: ✅ done (2026-10-31). 📘 = verify against official docs, ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 71 (Events 2.0), parts 8 and 9: live
> support during the event (222 offers text support during the experience), the Hebrew date for
> events, and sharing to WhatsApp. Tables by questionnaire, the late reveal and community
> organizers are a separate phase (71d): they change who can create events and need their own
> privacy review.

## What's here today (checked in the code)

- Questions to the organizers (phase 27): people going or waiting ask; staff see the question
  without who asked and answer; only the asker sees the answer. Nothing marks a question urgent,
  and nobody on the staff is told one arrived.
- Events show the Gregorian date only. There's no way to share an event.

## What changes

| Part                             | Change                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I need help now" (people going) | From 30 minutes before the start until the end: a short message marked urgent ("I can't find the place", "someone is bothering me"). Staff see it first, highlighted, and every admin gets a content-free push ("Someone at an event needs help"). The answer reaches only the asker, as today. The screen also points to emergency numbers (phase 66's safety resources) for anything serious. |
| Anonymous, as before             | Staff still don't see who wrote. If they need to find the person, the member can say where they are in the message ("at the bar, red jacket").                                                                                                                                                                                                                                                  |
| Hebrew date                      | In Hebrew, an event shows the Hebrew calendar date beside the Gregorian one (e.g. "כ׳ בחשוון תשפ״ז"), from the device's own calendar data 📘; nothing is sent anywhere.                                                                                                                                                                                                                         |
| Share an event                   | "Share" opens the device's share sheet (WhatsApp and others), or WhatsApp on the web, with the title, the date and a link to the event page. The link needs signing in, so only members see the place and details; nothing about who's going is shared.                                                                                                                                         |

## Security and privacy ⚖️

- An urgent message is a question to the organizers with a flag: same anonymity, same retention
  (deleted with the RSVPs, 30 days after the event), same harm filter.
- The push to admins carries no content. A limit: 3 urgent messages per member per event.
- Sharing sends only what the member chooses to send, through their own device.

## Tests

- Integration: urgent only during the event window, only for people going; staff board lists
  urgent first with the flag; admins are pushed (content-free), members aren't; the limit;
  anonymity unchanged.
- Unit: the Hebrew date formatter (with a fallback when the calendar isn't available) and the
  share text.
- e2e (en, he): a member going asks for help during the event; the dashboard shows it first,
  highlighted; staff answer and the member sees it. The Hebrew date and Share on the event page.
  axe 0. Screenshots.

## Done

- **Integration** (`event-board.test.ts`, "phase 71c"): urgent refused before the window and after
  the end, and for people not going; every admin gets a content-free `event_help` push, nobody
  else; staff see it first until answered, never who wrote; the answer reaches the asker; at
  most 3 per member per event.
- **Unit** (`apps/mobile/test/event-share.test.ts`): the Hebrew date in Hebrew letters (כ׳ בחשוון
  תשפ״ז, ו׳ באדר ב׳ תשפ״ז), gematria with ט״ו and ט״ז, null without the calendar; the share text.
- **e2e** `pnpm --dir e2e event-help` (en, he): the Hebrew date and Share on the event page; the
  member sends "I need help now"; the dashboard shows it first, marked, without who wrote; the
  admin answers; the member sees it. axe 0. Screenshots `182-event-help`, `admin-11-event-help`.
- ICU gives the Hebrew date with digits, so the day and year are written in Hebrew letters here.
- The `event_help` push comes even in quiet hours, like safety check-ins.
- Docs: PRIVACY.md, CHANGELOG, README.

### Not done here

- Tables by questionnaire, the late reveal of the place and table, and community organizers (71d).
