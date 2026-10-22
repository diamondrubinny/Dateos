# Privacy guide for operators

> 📘 = verify against the official text, ⚖️ = needs advice from a lawyer or privacy officer.
> This guide describes what the software does so you can meet your own obligations. It is **not legal
> advice and not a statement that any instance complies** with the GDPR, Israel's Privacy Protection
> Law or any other law. Compliance depends on how you run your community.

Whoever runs an instance (the **operator**) is the controller of its members' data. The Dateos project
(Diamond Rubinny and contributors) only publishes the software; it does not receive data from your
instance.

## 1. What the software collects, why, and for how long

Every row reflects the code (see the retention jobs in `apps/worker/src/profile-jobs.ts` and
`privacy-jobs.ts`). The legal bases are the ones the design assumes; confirm them for your community ⚖️.

| Data                                                                                                                                    | Purpose                                                                    | Suggested legal basis (GDPR)                                                                     | Kept for                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email address                                                                                                                           | Sign-in links, service email                                               | Contract, Art. 6(1)(b)                                                                           | Account lifetime                                                                                                                                                                                   |
| Session (random token, expiry). **No IP address or browser string** is stored                                                           | Keeping you signed in                                                      | Contract                                                                                         | 30 days, renewed while used; expired ones deleted daily                                                                                                                                            |
| Last seen (updated at most daily)                                                                                                       | Optional inactivity rule (§3)                                              | Legitimate interest: storage limitation                                                          | Account lifetime                                                                                                                                                                                   |
| Name, birth date (only the age is shown), bio, languages, intention, prompts                                                            | The profile                                                                | Contract                                                                                         | Until you change it or delete the account                                                                                                                                                          |
| **Gender and who you're interested in** (can reveal sexual orientation)                                                                 | Matching                                                                   | **Explicit consent, Art. 9(2)(a)** (`sensitive` consent) ⚖️                                      | Account lifetime. Withdrawing consent hides the profile at once                                                                                                                                    |
| Photos (re-encoded, all metadata including GPS removed)                                                                                 | The profile                                                                | Contract                                                                                         | Until you delete them or the account                                                                                                                                                               |
| Approximate location (a ~1 km grid cell; exact coordinates are never stored)                                                            | Distance filter                                                            | Consent (`location`)                                                                             | Until removed in Settings or the account is deleted                                                                                                                                                |
| Profile embedding (numbers derived from your bio and prompts)                                                                           | "Vibe" matching                                                            | Contract                                                                                         | Recomputed on change; deleted with the account                                                                                                                                                     |
| Likes, passes, comments on likes                                                                                                        | Matching                                                                   | Contract                                                                                         | Account lifetime                                                                                                                                                                                   |
| Impressions and daily picks                                                                                                             | Not showing the same people again                                          | Contract                                                                                         | 30 days                                                                                                                                                                                            |
| Matches, messages, chat photos, voice messages                                                                                          | Chat                                                                       | Contract                                                                                         | While the match exists; **30 days after an unmatch or block** the chat and its media are purged                                                                                                    |
| Blocks                                                                                                                                  | Safety                                                                     | Legitimate interest                                                                              | Account lifetime                                                                                                                                                                                   |
| Reports and copied evidence (texts, chat photos, voice notes)                                                                           | Safety, handling abuse                                                     | Legitimate interest; legal obligation where applicable ⚖️                                        | **12 months after the report is resolved**, even if the reported account is deleted                                                                                                                |
| Moderation log (warnings, suspensions, reasons)                                                                                         | Accountability, repeat abuse                                               | Legitimate interest                                                                              | 24 months                                                                                                                                                                                          |
| Banned email hash (keyed HMAC, not the address)                                                                                         | Stopping ban evasion                                                       | Legitimate interest                                                                              | Until the ban is lifted ⚖️ (no automatic expiry: review bans periodically)                                                                                                                         |
| Photo verification selfie                                                                                                               | Verified badge (optional)                                                  | Consent                                                                                          | Selfie **deleted when a moderator decides**; abandoned requests after 7 days; the decision record for 24 months. A human compares the photos: **no face recognition and no biometric template** ⚖️ |
| Consent records (what, which version, when)                                                                                             | Proving consent, Art. 7(1)                                                 | Legal obligation                                                                                 | Account lifetime ⚖️ (decide whether you must keep proof after deletion)                                                                                                                            |
| Safety check-in (optional): place and note the member writes, times, the match's first name, a trusted contact's name and email address | Emailing the contact only if the member misses the check-in or presses SOS | Legitimate interest / vital interests for the alert; the contact's data comes from the member ⚖️ | Deleted 7 days after the check-in ends (or immediately when cancelled)                                                                                                                             |
| Date ideas in a chat: a copy of the chosen place (name, area, address), the time, an optional note, the status                          | Proposing and agreeing on a first date                                     | Contract (the service the members asked for)                                                     | With the chat: deleted with the match, 30 days after an unmatch, or with either account ⚖️                                                                                                         |
| "Close kindly" message                                                                                                                  | Shown to the other person for 7 days                                       | Contract                                                                                         | With the closed match (purged 30 days after the unmatch)                                                                                                                                           |
| Push device token (only if notifications are turned on)                                                                                 | Notifications                                                              | Consent                                                                                          | Until sign-out, opt-out, an invalid token or account deletion                                                                                                                                      |
| Security audit log (who did what, no message content)                                                                                   | Security, accountability for staff actions                                 | Legitimate interest                                                                              | 24 months                                                                                                                                                                                          |
| Rate-limit counters (keyed by IP)                                                                                                       | Protection against abuse                                                   | Legitimate interest                                                                              | About 1 day                                                                                                                                                                                        |
| Server logs (include IP addresses)                                                                                                      | Security, debugging                                                        | Legitimate interest                                                                              | Size-limited by docker-compose (about 50 MB per service); set your own limit if you ship logs elsewhere                                                                                            |
| Staff: authenticator secret (AES-256-GCM encrypted), MFA session                                                                        | Securing staff accounts                                                    | Legitimate interest                                                                              | While staff; MFA sessions 1 day                                                                                                                                                                    |

**Never collected:** exact location, contacts, device identifiers for tracking, advertising IDs,
analytics (none is built in), payment data, ID documents.

**People under 18:** an underage birth date suspends the account at once and no profile is stored.

## 2. Third parties (processors and recipients)

| Who                                                                    | When                                                              | What is sent                                                               | Notes                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Your hosting provider                                                  | Always                                                            | Everything above (encrypted in transit; enable disk encryption)            | DPA with the provider ⚖️                                        |
| Your email (SMTP) provider                                             | Sign-in links, inactivity warnings, check-in alerts               | Email address, message (for alerts: what the member shared about the date) | DPA ⚖️                                                          |
| A member's trusted contact (a person, not a processor)                 | Only when that member misses a check-in or presses SOS            | The details the member wrote for that date                                 | The member chooses to share; the contact gets no other email ⚖️ |
| Object storage (SeaweedFS on your server by default, or an S3 service) | Photos, voice, evidence                                           | Files                                                                      | DPA if external ⚖️                                              |
| Expo, Apple (APNs), Google (FCM)                                       | Only for members who turn on notifications                        | Device token and "New message" / "It's a match", **no names or text**      | Transfers outside your country 📘⚖️                             |
| An external AI endpoint                                                | Only if you configure one **and** the member turned on `ai_cloud` | Bio and prompt text, never name, age, gender or photos                     | See `docs/AI.md` ⚖️                                             |
| Google / Apple sign-in                                                 | Only if you enable them and the member uses them                  | The provider tells you the email address                                   | 📘                                                              |

No analytics, advertising, social or tracking scripts are included. The web app loads nothing from
other servers (the privacy e2e test fails if it does).

## 3. Storage limitation tools

- **Daily jobs** (worker): purge closed chats (30 days), impressions and picks (30 days), resolved
  reports (12 months), moderation log and verification records (24 months), security audit log
  (24 months), expired sessions and sign-in tokens, rate-limit rows, orphaned evidence files.
- **Inactive accounts (optional, off by default):** `INACTIVE_ACCOUNT_DELETE_MONTHS=24` (for example)
  emails people who have not signed in for 24 months; anyone who still hasn't signed in 30 days later
  is deleted with all their files. Signing in cancels it. Staff accounts are never included. The email
  has no links (it can't be confused with phishing). Choose the period with legal advice ⚖️.

## 4. Members' rights

| Right                                   | How                                                                                                                                                       | Where                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Access and portability                  | **Download my data**: a ZIP with `data.json` and the member's photos and voice messages. Other people's messages, staff notes and secrets are left out ⚖️ | Settings (also on the suspension screen); 3 a day                 |
| Rectification                           | Edit the profile, photos, prompts, preferences                                                                                                            | Profile tab                                                       |
| Erasure                                 | **Delete account**: immediate; the database rows go at once and the files in a background job                                                             | Settings (also while suspended)                                   |
| Withdrawing consent                     | Sensitive data (hides the profile), location, AI, notifications                                                                                           | Settings                                                          |
| Objection / restriction / anything else | Email the operator                                                                                                                                        | The contact shown on the legal pages (set it in the admin wizard) |

Answer requests within the legal deadline (GDPR: one month, Art. 12(3); Israel: also check the
deadlines in the law and its regulations 📘⚖️). Verify identity by asking the person to write from the
account's email address or to sign in. Never send data to a different address.

Moderators can see reports and evidence, never members' private chats outside a report.

## 5. Security incidents

1. Contain (revoke sessions: `DELETE FROM session`; rotate `AUTH_SECRET`, database and storage keys).
2. Record what happened, what data, how many people, when it was found (keep the record even if you
   don't notify).
3. **GDPR:** notify your supervisory authority within 72 hours of becoming aware, unless the breach is
   unlikely to result in a risk; notify the people affected without undue delay when the risk is high
   (Art. 33–34).
4. **Israel:** the Privacy Protection (Data Security) Regulations 2017 require reporting severe security
   incidents to the Privacy Protection Authority 📘⚖️.
5. Gender and interests reveal orientation: treat any leak of profile data as high risk.

## 6. DPIA screening

A dating service processes sensitive data (orientation), location and private messages of many people,
which meets several of the EDPB's criteria for a high-risk processing. **Plan a Data Protection Impact
Assessment (Art. 35) before you launch** ⚖️. The threat models in `docs/phases/` and this guide are a
starting point.

| Criterion (EDPB guidelines)      | Present?                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| Sensitive data (orientation)     | Yes                                                                       |
| Large scale                      | Depends on your community                                                 |
| Location data                    | Yes (approximate)                                                         |
| Evaluation or scoring (matching) | Yes, explainable and without legal effects                                |
| Innovative technology (AI)       | Only if you turn on AI features                                           |
| Vulnerable people                | Possibly (members at risk because of their orientation in some countries) |

## 7. Israel: Privacy Protection Law and Amendment 13 ⚖️

Amendment 13 (in force since August 2025 📘) widened the definitions and the regulator's enforcement
powers, and introduced obligations for some controllers to appoint a privacy protection officer.
Questions to take to a lawyer:

- Does your database need to be registered or reported (number of people, sensitive information)? 📘
- Do you have to appoint a privacy protection officer? (Processing sensitive information such as sexual
  orientation, especially at scale, is a typical trigger 📘.)
- Which security level of the 2017 Data Security Regulations applies, and what documentation and
  periodic reviews does it require? 📘
- Notice duties when collecting data (section 11) — the draft privacy policy in `docs/legal/` is a start.

## 8. European Union and GDPR ⚖️

- Representative in the EU (Art. 27) if you are outside the EU but offer the service to people there.
- Records of processing (Art. 30): the table in §1 is a basis.
- International transfers: depends on where you host. Israel has an EU adequacy decision 📘; push
  notifications go through US companies.
- Data Protection Officer: likely required when the core activity is large-scale processing of special
  categories of data (Art. 37) ⚖️.

## 9. Before you launch

- [ ] Fill in the operator details in the admin wizard (name, contact email).
- [ ] Adapt the drafts in `docs/legal/` and have them reviewed ⚖️; publish them and bump
      `TERMS_VERSION` / `PRIVACY_VERSION` so members accept the reviewed versions.
- [ ] DPA with every provider in §2.
- [ ] DPIA (§6), and the Israeli questions in §7.
- [ ] Decide on `INACTIVE_ACCOUNT_DELETE_MONTHS` and a review routine for bans.
- [ ] Disk encryption and encrypted, tested backups (backups also need a retention period).
- [ ] A process for data requests and incidents (§4, §5).
