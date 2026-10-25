# Draft legal texts

> ⚖️ **Drafts only.** These texts describe what the NexaHeart software does. They are not legal advice and
> must be reviewed by a lawyer for your country and community before you publish them.

| Document                                                  | English                                                        | עברית                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Privacy policy                                            | [privacy-policy.en.md](privacy-policy.en.md)                   | [privacy-policy.he.md](privacy-policy.he.md)                   |
| Terms of use                                              | [terms.en.md](terms.en.md)                                     | [terms.he.md](terms.he.md)                                     |
| Cookie policy                                             | [cookie-policy.en.md](cookie-policy.en.md)                     | [cookie-policy.he.md](cookie-policy.he.md)                     |
| Accessibility statement                                   | [accessibility-statement.en.md](accessibility-statement.en.md) | [accessibility-statement.he.md](accessibility-statement.he.md) |
| Partnership agreement (between two communities, phase 28) | [partnership-agreement.en.md](partnership-agreement.en.md)     | [partnership-agreement.he.md](partnership-agreement.he.md)     |

Replace every `[PLACEHOLDER]`: `[OPERATOR]` (legal name), `[ADDRESS]`, `[CONTACT_EMAIL]`, `[COMMUNITY]`
(the instance name), `[HOSTING_PROVIDER]` and its country, `[EMAIL_PROVIDER]`, `[EFFECTIVE_DATE]`,
`[ACCESSIBILITY_COORDINATOR]`. Delete the sections for features you don't enable (for example external
AI or Google/Apple sign-in).

When a reviewed version goes live, publish it and bump `TERMS_VERSION` / `PRIVACY_VERSION` in `.env`:
members are then asked to accept the new version. The short texts inside the app
(`apps/mobile/src/i18n`) summarise these documents; keep them consistent.
