# Partnership and data-sharing agreement between communities (draft)

> ⚖️ **Draft template, not legal advice.** It describes what the NexaHeart software exchanges when two
> communities connect (phase 28). Have it reviewed by a lawyer for both operators' countries before
> signing, and adapt it to your communities. Both admins confirm in the dashboard that it is signed
> before a partnership becomes active.

**Between** [OPERATOR_A], [ADDRESS_A], operating the community [COMMUNITY_A] at [API_URL_A]
("Community A"), **and** [OPERATOR_B], [ADDRESS_B], operating the community [COMMUNITY_B] at
[API_URL_B] ("Community B"), together "the Parties". Effective [EFFECTIVE_DATE].

## 1. Purpose

The Parties connect their communities so that members who choose to can see each other, match and
chat with text, and report each other for safety. Nothing else is in scope: no advertising, no
analytics, no sale or other use of members' data.

## 2. Roles ⚖️

2.1 For the processing described here, the Parties are **joint controllers** (GDPR Art. 26), or
otherwise each a controller of the data it receives (choose with counsel). Under Israel's Privacy
Protection Law each Party remains the owner of its own database and is responsible for what it
receives.

2.2 Each Party is the **point of contact for its own members**: it answers their questions and
requests (access, correction, deletion, objection) and passes on to the other Party what it needs
to act on them. The essence of this agreement is made available to members (GDPR Art. 26(2)), for
example in each privacy policy.

## 3. What is shared, and what never is

3.1 **Only about members who joined** "Partner communities" in the app, with explicit consent
(versioned in the software). Members can leave at any time.

3.2 **Shared:** a random code name for each member, different per partner (never the account id);
first name, age, gender, what they are looking for, bio, prompt answers, languages, whether a
moderator verified their photos; profile photos, **served each time through the member's own
community and not copied**; for each search, the viewer's gender, who they are interested in,
their age and the ages they look for; likes; matches (first name and one photo); text messages
between matched members; reports (category, the reporter's words, the latest messages of their
chat) and whether a report was reviewed.

3.3 **Never shared:** email, phone, exact location or distance, religion, accessibility needs,
voice, friends' takes, the identity of a reporter, moderation decisions, and anything about
members who didn't join.

3.4 Gender and who someone is interested in may reveal **sexual orientation**, a special category
of data (GDPR Art. 9; "sensitive information" in Israeli law). It is shared only on explicit
consent, used only for the search it comes with, and not stored by the receiving Party.

## 4. Use

Each Party uses what it receives only to show partner members to its own members, deliver likes,
matches and messages, and handle safety. It does not profile members, combine the data with other
sources, share it with third parties (other than its processors under contract), or use it to
train models.

## 5. Safety and moderation

5.1 A report about a Party's member is handled by **that Party**, under its own rules, within
[REVIEW_DAYS] days ([URGENT_HOURS] hours for possible minors and threats), and it tells the other
Party only that the report was reviewed.

5.2 Each Party keeps its moderation queue staffed, keeps the reporter's identity out of it, and
contacts the other Party at [SAFETY_CONTACT] when a case needs both (for example a threat to
someone's safety). Duties to inform authorities stay with each Party under its own law.

5.3 Either Party may **suspend** the partnership at once if it believes the other ignores reports
or puts members at risk; it tells the other Party why within [NOTICE_DAYS] days.

## 6. Retention and deletion

6.1 Each Party keeps what it received only as long as needed: a member's data is deleted when they
leave, delete their account, or are suspended (matches and chats end), and everything received
from the other Party is deleted when the partnership ends.

6.2 The software tells the other Party automatically and retries for 7 days if it can't be reached;
each Party acts on such a request without delay and does not keep backups of the other's data for
longer than [BACKUP_DAYS] days.

6.3 Reports received are kept as that Party's own reports ([RETENTION]).

## 7. Security

Each Party runs the software as documented (signed and dated requests between servers, its signing
key protected, HTTPS only), keeps it updated, replaces its signing key if it may have leaked, limits
staff access, and protects what it receives at least as well as its own members' data.

## 8. Incidents

A Party that learns of a personal data breach affecting what it received tells the other within
[BREACH_HOURS] hours, with what is known, and they cooperate on notifications to authorities and
members required by their laws.

## 9. International transfers ⚖️

If the Parties are in different countries, the transfer basis is [ADEQUACY / STANDARD CONTRACTUAL
CLAUSES / OTHER], attached as Annex 2. (Israel has an EU adequacy decision; check the other
direction and any other country with counsel.)

## 10. Minors

Each Party admits only adults (18+) under its own checks and suspends anyone it finds to be under
18 at once; the software then ends their matches and chats on both sides.

## 11. Liability

Each Party is responsible for its own processing and its own members. [LIABILITY_CLAUSE, to be
drafted by counsel.]

## 12. Term and ending

This agreement starts when both Parties confirm it in the dashboard and lasts until either ends the
partnership there, which takes effect at once. Sections 6, 8 and 11 survive.

## 13. Contacts

|                         | Community A         | Community B         |
| ----------------------- | ------------------- | ------------------- |
| Operator                | [OPERATOR_A]        | [OPERATOR_B]        |
| Privacy contact         | [PRIVACY_CONTACT_A] | [PRIVACY_CONTACT_B] |
| Safety contact (urgent) | [SAFETY_CONTACT_A]  | [SAFETY_CONTACT_B]  |

**Signed** for Community A: \_\_\_\_\_\_\_\_\_\_ (name, role, date) · for Community B: \_\_\_\_\_\_\_\_\_\_
(name, role, date)

---

**Annex 1: the data exchanged.** The table in section 3, and the technical description in
[`docs/phases/PHASE-28.md`](../phases/PHASE-28.md).

**Annex 2: transfer clauses**, if needed (section 9).
