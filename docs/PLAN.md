# Dateos — אפיון ותוכנית עבודה (MVP → v1)

> סטטוס: **טיוטה לאישור (גרסה 2 – חינם לכולם, Self-hosted)**. אף שורת קוד מוצר לא תיכתב לפני אישור המסמך הזה (בהתאם לעקרונות העבודה).
> כל סעיף שמסומן ⚖️ דורש בדיקה משפטית, וכל סעיף שמסומן 📘 דורש אימות מול התיעוד הרשמי.

---

## 1. חזון והבנת המוצר

**Dateos** היא אפליקציית דייטינג נייטיב (iOS + Android), קוד פתוח מלא ו-self-hostable, שמתחרה ב-Tinder / Bumble / Hinge בשלושה צירים:

1. **התאמה איכותית ולא התמכרותית** – מנוע המלצות הדדי (Reciprocal) מבוסס AI שממקסם סיכוי להתאמה _דו-צדדית_ ולשיחה אמיתית, לא זמן מסך. "סלואו דייטינג": מכסה יומית של המלצות איכותיות + הסבר "למה התאמנו".
2. **בטיחות ואמון כברירת מחדל** – אימות פנים (liveness), זיהוי הטרדה ותרמיות בזמן אמת, שיתוף פרטי דייט עם איש קשר בטוח, אין חשיפת מיקום מדויק לעולם.
3. **פרטיות ושקיפות של קוד פתוח** – האלגוריתם פתוח לביקורת, אפשרות להריץ AI מקומי (ללא שליחת מידע לצד שלישי), שליטה מלאה של המשתמש בנתונים שלו (ייצוא/מחיקה).

**קהל יעד ראשוני (הנחה):** ישראל (עברית/RTL) + אנגלית, גילאי 18+ בלבד, כל הזהויות והנטיות.

---

## 2. שאלות הבהרה (5) והנחות עבודה

| #   | שאלה                                            | הנחת עבודה אם אין תשובה                                                                                    |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | שוק השקה: ישראל בלבד, או גם EU/US מהיום הראשון? | ישראל + EU (מתכננים ל-GDPR מההתחלה, זה זול יותר מהתאמה מאוחרת).                                            |
| 2   | רישיון                                          | ✅ **הוחלט: MIT** – חופש מקסימלי, כל אחד יכול להקים, לשנות ולמתג.                                          |
| 3   | ספק AI                                          | ✅ ברירת מחדל **מקומית וחינמית** (Ollama); ספק ענן חיצוני – אופציה שהמפעיל מפעיל במפתח שלו, בהסכמת המשתמש. |
| 4   | מודל הכנסות                                     | ✅ **הוחלט: חינם לגמרי לכולם.** אין Premium, אין Paywall, אין פרסומות. כל הפיצ'רים פתוחים לכל משתמש.       |
| 5   | פילוחים מיוחדים (דתי/מסורתי, LGBTQ+, 50+)?      | פילטרים אופציונליים; שדות רגישים (דת, נטייה) – אופציונליים, מוצפנים ולא חובה. ⚖️                           |

**הנחות טכניות נוספות:** צוות קטן (1–3 מפתחים), תקציב תשתית נמוך בהתחלה (VPS יחיד + Docker Compose), סקייל יעד ראשון: 50K משתמשים.

---

## 2.1 עיקרון מנחה: "חינם לכל העולם, כל אחד מקים"

- **אפס עלות רישוי ואפס תלות בשירות בתשלום** – כל רכיב בסטאק הוא קוד פתוח וניתן להרצה עצמית. שירות בתשלום (SMS, AI ענני, ספק אימות) הוא תמיד **תוסף אופציונלי**, לעולם לא חובה.
- **"Instance" לכל קהילה** – כל אדם/ארגון מקים אתר + אפליקציה משלו (עיר, קהילה, קהל יעד), עם שם, לוגו, צבעים, שפה, תנאים ופילטרים משלו – בלי לגעת בקוד.
- **התקנה בפקודה אחת:** `docker compose up` / סקריפט `./install.sh` → **Setup Wizard** בדפדפן (יצירת אדמין עם MFA, דומיין, מיתוג, ספקי Login, מדיניות).
- **Web + Native מאותו קוד:** אפליקציית Expo רצה גם כ-**Web/PWA** (react-native-web) – כך מפעיל יכול לעלות לאוויר מיד בחינם, בלי חשבון מפתח ב-App Store ($99/שנה) או Google Play ($25 חד-פעמי) 📘. בניית אפליקציה ממותגת לחנויות – מתועדת כשלב אופציונלי (EAS / build מקומי).
- **דרישות שרת מינימליות:** יעד – VPS יחיד 4GB RAM ללא AI, 8–16GB עם AI מקומי. מצב "Lite" בלי ClamAV/Ollama לשרתים קטנים (עם אזהרה ברורה בלוח הניהול).
- **אחריות המפעיל:** מי שמקים Instance הוא בעל המאגר והאחראי החוקי עליו ⚖️ – ה-Wizard יציג זאת, ויספק טיוטות מסמכים משפטיים לעריכה.

## 3. פיצ'רים — MVP מול גרסאות הבאות

### MVP (v0.1)

- הרשמה: **Email magic link / Passkeys (חינמי, ברירת מחדל)** + Apple / Google; טלפון (OTP) – אופציונלי למפעיל עם ספק SMS, אימות גיל 18+ (הצהרה + תאריך לידה; אימות מסמך – שלב 2).
- פרופיל: 3–9 תמונות, 3 "Prompts" (טקסט/קול), כוונות (קשר רציני/דייטים/פתוח), תחומי עניין, שפה.
- Discovery: כרטיסים + **Daily Picks** (10 המלצות AI ביום) + פילטרים (גיל, מרחק, כוונות).
- Like / Pass / **Like עם תגובה לפריט ספציפי** (תמונה/Prompt) – כמו Hinge, מעלה איכות שיחות.
- Match + צ'אט בזמן אמת (טקסט, תמונה, הודעה קולית), Read receipts אופציונלי.
- **AI Icebreakers** – 3 פתיחות מותאמות לפרופיל של הצד השני.
- **"Are you sure?"** – זיהוי הודעה פוגענית לפני שליחה + סינון הודעות פוגעניות שהתקבלו.
- Block / Report / Unmatch בכל מסך, מחיקת חשבון מלאה מתוך האפליקציה.
- אימות תמונה (Selfie Verification) עם תג ✔️.
- התראות Push, עברית/אנגלית מלא + RTL.
- לוח ניהול (Web) למודרציה.

### v0.2–v0.5

- **"למה התאמנו"** – הסבר שקוף של ההמלצה (Explainable matching).
- **AI Profile Coach** – משוב על תמונות ו-Prompts (איכות, תאורה, גיוון) – בהסכמה.
- **Date Planner** – הצעות למקום/פעילות בנקודת אמצע (ללא חשיפת מיקום מדויק).
- **Safety Check-in** – שיתוף פרטי דייט + טיימר ו-SOS לאיש קשר בטוח.
- **Video Date בתוך האפליקציה** (WebRTC דרך LiveKit, ללא חשיפת מספר טלפון).
- **Anti-Ghosting** – תזכורות עדינות + "הודעת סגירה" מנומסת בלחיצה.
- Romance-scam detection (בקשות כסף, קישורים חשודים, מעבר מהיר לפלטפורמה חיצונית).
- Incognito, Travel mode, Pause profile.
- אירועים וקבוצות (Group/Double dating).

### v1+

- הצפנה מקצה לקצה לצ'אט (Signal Protocol) – ראה סיכונים.
- אימות זהות מבוסס מסמך דרך ספק חיצוני. ⚖️
- Federated / multi-instance (קהילות שמריצות שרת משלהן).

---

## 4. User Stories (MVP)

- **US-01** כמשתמש חדש, אני רוצה להירשם עם אימייל (קישור קסם) או Passkey כדי להתחיל בלי סיסמה.
- **US-00** כמפעיל, אני רוצה להקים Instance ממותג משלי בפקודה אחת ו-Wizard, בלי לכתוב קוד.
- **US-02** כמשתמש, אני רוצה לבנות פרופיל עם תמונות ו-Prompts כדי להציג את עצמי מעבר למראה.
- **US-03** כמשתמש, אני רוצה לקבל Daily Picks מותאמים כדי לא לבזבז זמן בהחלקות אינסופיות.
- **US-04** כמשתמש, אני רוצה לעשות Like לפריט ספציפי עם תגובה כדי לפתוח שיחה משמעותית.
- **US-05** כמשתמש, אני רוצה לקבל הצעות פתיחה מה-AI כשאני לא יודע מה לכתוב.
- **US-06** כמשתמש, אני רוצה לחסום ולדווח בלחיצה אחת ולהיות בטוח שהצד השני לא יראה אותי יותר.
- **US-07** כמשתמשת, אני רוצה שהודעות פוגעניות יוסתרו עד שאבחר לראות אותן.
- **US-08** כמשתמש, אני רוצה לאמת את עצמי בסלפי כדי לקבל תג אמינות.
- **US-09** כמשתמש, אני רוצה לייצא ולמחוק את כל המידע שלי מתוך האפליקציה.
- **US-10** כמודרטור, אני רוצה תור דיווחים עם עדיפויות וכלים לחסימה/אזהרה עם Audit Log.
- **US-11** כמשתמש עם קורא מסך, אני רוצה לנווט, לעשות Like ולשוחח בלי מחוות החלקה (כפתורים חלופיים).

---

## 5. מסכים וזרימות

**Onboarding:** Welcome → בחירת שפה → הרשמה (אימייל/Passkey/Apple/Google) → אימות → תאריך לידה (חסימה מתחת ל-18) → הסכמות (תנאים, פרטיות, AI אופציונלי, מיקום) → שם + מגדר + מי מעניין אותי → תמונות → Prompts → כוונות → הרשאת מיקום (מוסבר) → הרשאת התראות → Discovery.

**טאבים ראשיים:** Discover (כרטיסים) · Picks (יומי) · Likes You · Chats · Profile.

**מסכים נוספים:** פרופיל מלא של אחר · Like עם תגובה · מסך Match · שיחה · Icebreakers (Bottom sheet) · Report flow (קטגוריות + פירוט) · Block · Verification (מצלמה) · הגדרות (פרטיות, התראות, פילטרים, שפה, נגישות, Pause, מחיקה, ייצוא) · הצהרת נגישות · מדיניות פרטיות · תנאי שימוש · מצבי Empty/Error/Offline.

**Admin (Web):** Setup Wizard (התקנה ראשונה) · Branding & Settings · Login + MFA · Dashboard · תור דיווחים · צפייה בתיק משתמש (מינימלי, עם תיעוד גישה) · פעולות (אזהרה / השעיה / חסימה) · תור אימותים · Audit log · בקשות DSAR.

---

## 6. ארכיטקטורה

```
┌──────────────┐    HTTPS / WSS    ┌──────────────────────────────┐
│ Mobile (Expo)│ ────────────────▶ │  API Gateway (Fastify, TS)   │
│ iOS/Android  │ ◀──────────────── │  REST + WebSocket (chat)     │
└──────────────┘                   └──────┬───────────┬───────────┘
┌──────────────┐                          │           │ enqueue
│ Admin (Next) │ ────────────────────────▶│           ▼
└──────────────┘                   ┌──────┴─────┐  ┌──────────────┐
                                   │ PostgreSQL │  │ Redis        │
                                   │ + PostGIS  │  │ BullMQ/Rate  │
                                   │ + pgvector │  │ limit/Pres.  │
                                   └──────▲─────┘  └──────┬───────┘
                                          │               ▼
                                   ┌──────┴───────────────────────┐
                                   │ Workers (TS)                 │
                                   │ media-scan · image-process   │
                                   │ embeddings · recs · moderation│
                                   └──┬──────────┬───────────┬────┘
                                      ▼          ▼           ▼
                               S3/SeaweedFS     ClamAV      AI Provider
                          (quarantine→clean)          (Ollama | ענן)
                                                      LiveKit (video, v0.3)
```

**עקרונות:** Monolith מודולרי (לא microservices) – מודולים: `auth`, `profiles`, `media`, `discovery`, `matching`, `chat`, `safety`, `ai`, `notifications`, `privacy`, `admin`. כל מודול: `routes → service → repository`. סכמות Zod משותפות לקליינט ולשרת.

### מנוע ההתאמה (AI Matching)

1. **Candidate generation** – PostGIS (מרחק) + פילטרים הדדיים (שני הצדדים עומדים בהעדפות של השני) + החרגת חסומים/נראו.
2. **Scoring** – ציון הדדי: `P(A likes B) × P(B likes A)`:
   - דמיון Embeddings (pgvector) של טקסט פרופיל, תחומי עניין וכוונות.
   - Collaborative filtering על אינטראקציות (Implicit ALS / two-tower בהמשך).
   - איתות איכות: אחוזי מענה, אורך שיחות, אימות.
3. **Re-ranking להוגנות** – הגבלת חשיפה (exposure cap) כדי למנוע ריכוז בפרופילים פופולריים; חשיפה מובטחת למשתמשים חדשים; **ללא Elo/דירוג אטרקטיביות**.
4. **Explainability** – כל המלצה שומרת 2–3 סיבות מובנות ("שניכם אוהבים טיולים", "כוונות זהות").
5. **Anti-bias** – לא משתמשים בגזע/מוצא/דת כאיתות לדירוג; רק כפילטר מפורש שהמשתמש בחר. ⚖️

### שכבת AI (`packages/ai`)

ממשק `LlmProvider` / `EmbeddingProvider` / `ModerationProvider` עם מימושים:

- **מקומי:** Ollama (LLM + embeddings) – ברירת מחדל, אין העברת מידע לצד שלישי.
- **ענן (אופציונלי, טרם מומש):** ספק LLM חיצוני רק בהסכמה מפורשת של שני הצדדים ו-DPA מול הספק. ⚖️
- תוכן הצ'אט **לא נשלח** ל-LLM ענני. Moderation בצ'אט רץ מקומית (מסווג קל).

---

## 7. החלטות טכנולוגיות וחלופות

| תחום          | בחירה                                                                              | למה                                                            | חלופות                                                               | מגבלות/עלות תחזוקה                                  |
| ------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| Mobile        | **React Native + Expo (TS)**                                                       | קוד אחד ל-iOS/Android, TS משותף עם השרת, OTA updates, RTL נתמך | Flutter (ביצועים טובים, Dart), Swift+Kotlin (הכי נייטיב, פי 2 עבודה) | מודולים נייטיביים דורשים dev build; RTL דורש reload |
| API           | **Fastify + Zod**                                                                  | מהיר, פשוט, טיפוסים מצוינים                                    | NestJS (מבנה כבד יותר), tRPC                                         | פחות "batteries included"                           |
| DB            | **PostgreSQL 16 + PostGIS + pgvector**                                             | גאו + וקטורים + רלציוני במקום אחד                              | Mongo+Elastic+Pinecone (3 מערכות)                                    | pgvector מוגבל בסקייל של עשרות מיליונים             |
| ORM           | **Drizzle**                                                                        | SQL-first, תמיכה ב-custom types (geography/vector) 📘          | Prisma (פחות נוח עם PostGIS)                                         | מיגרציות דורשות משמעת                               |
| Queue/Cache   | **Redis + BullMQ**                                                                 | סטנדרט, פשוט                                                   | RabbitMQ, NATS                                                       | Redis יחיד = SPOF בהתחלה                            |
| Auth          | **better-auth** (self-hosted, magic link, passkeys, OAuth, phone OTP אופציונלי) 📘 | קוד פתוח, ללא Vendor lock-in                                   | Supabase Auth, Ory Kratos, Clerk (סגור)                              | ספרייה צעירה – לאמת בשלות                           |
| Email         | **SMTP כלשהו** (של המפעיל)                                                         | חינמי/זול, סטנדרטי                                             | SMS OTP (תוסף בתשלום)                                                | deliverability – צריך SPF/DKIM                      |
| Web/PWA       | **react-native-web** דרך Expo                                                      | השקה חינמית בלי חנויות                                         | אפליקציית Next נפרדת                                                 | חלק מהמודולים הנייטיביים חסרים ב-Web                |
| Media         | **S3 API (SeaweedFS self-host, Apache-2.0)** + presigned URLs + `sharp`            | הסרת EXIF/GPS, re-encode                                       | Garage, RustFS, Cloudinary (סגור). MinIO CE הוצא משימוש              | —                                                   |
| AV            | **ClamAV** (container)                                                             | קוד פתוח                                                       | שירות סריקה מנוהל                                                    | צריכת זיכרון ~1GB+                                  |
| Realtime      | **WebSocket (`ws`) + Redis pub/sub**                                               | שליטה מלאה                                                     | Socket.IO, Matrix                                                    | ניהול reconnect בעצמנו                              |
| Video         | **LiveKit** (self-host)                                                            | WebRTC קוד פתוח, SDK ל-RN 📘                                   | Jitsi, Agora (סגור)                                                  | TURN server נדרש                                    |
| Push          | **Expo Notifications** (FCM/APNs)                                                  | פשוט                                                           | ישיר ל-FCM/APNs                                                      | תלות בשירות Expo push 📘                            |
| Admin         | **Next.js**                                                                        | מהיר לבנייה                                                    | React+Vite                                                           | —                                                   |
| Monorepo      | **pnpm + Turborepo**                                                               | שיתוף קוד וטיפוסים                                             | Nx                                                                   | —                                                   |
| Observability | OpenTelemetry + Pino (redaction) + Sentry self-host/GlitchTip                      |                                                                |                                                                      |                                                     |

---

## 8. סכמת בסיס נתונים (טבלאות עיקריות)

```
users(id uuid pk, status enum[active,paused,suspended,deleted], role enum[user,moderator,admin],
      birth_date date, created_at, deleted_at)
auth_identities(id, user_id fk, provider enum[phone,apple,google], provider_uid_hash, created_at)
sessions(id, user_id, refresh_token_hash, device_id, expires_at, revoked_at)
profiles(user_id pk/fk, display_name, gender, interested_in text[], intentions enum,
         bio, languages text[], height_cm?, is_verified bool, visibility enum[visible,incognito,paused])
profile_sensitive(user_id pk, religion_enc bytea?, orientation_enc bytea?)        -- אופציונלי, מוצפן ברמת שדה ⚖️
photos(id, user_id, storage_key, status enum[quarantine,clean,rejected], position, nsfw_score, created_at)
prompts(id, user_id, prompt_key, answer_text?, audio_key?, position)
preferences(user_id pk, age_min, age_max, max_distance_km, genders text[], intentions enum[])
locations(user_id pk, geo geography(Point) -- מעוגל ~1 ק"מ, city, updated_at)
profile_embeddings(user_id pk, embedding vector(768), model, updated_at)
interactions(id, actor_id, target_id, kind enum[like,pass,superlike], target_item_id?, comment?, created_at,
             unique(actor_id,target_id))
matches(id, user_a, user_b, created_at, unmatched_at?, unmatched_by?)            -- user_a < user_b
conversations(id, match_id unique)
messages(id, conversation_id, sender_id, type enum[text,image,audio], body?, media_key?,
         moderation enum[ok,flagged,hidden], created_at, read_at?)                -- partition לפי חודש
blocks(blocker_id, blocked_id, created_at, pk(blocker_id,blocked_id))
reports(id, reporter_id, reported_id, category enum, details, evidence_refs jsonb, status, assigned_to?, created_at)
moderation_actions(id, target_user_id, moderator_id, action enum, reason, expires_at?, created_at)
verifications(id, user_id, kind enum[selfie,document], status, provider_ref?, created_at)  -- תמונת ה-liveness נמחקת אחרי החלטה
recommendations(user_id, candidate_id, score, reasons jsonb, served_on date)
consents(id, user_id, kind enum[terms,privacy,ai_cloud,location,marketing], version, granted bool, created_at)
push_tokens(id, user_id, token_hash, platform, created_at)
safety_checkins(id, user_id, match_id?, trusted_contact_enc, starts_at, ends_at, status)
data_requests(id, user_id, kind enum[export,delete], status, created_at, completed_at)
audit_logs(id, actor_id, action, target_type, target_id, meta jsonb (ללא PII), ip_hash, created_at)
```

**אינדקסים מרכזיים:** GiST על `locations.geo`, HNSW על `profile_embeddings.embedding`, `(target_id, kind)` על interactions, `(conversation_id, created_at)` על messages.

---

## 9. API Endpoints (v1)

🔓 = ציבורי (עם Rate limit) · 🔐 = משתמש מחובר · 🛡️ = מודרטור/אדמין + MFA

```
Auth
 🔓 POST /v1/auth/magic-link/request {email}           -- rate limit, תגובה זהה תמיד (לא חושף קיום משתמש)
 🔓 POST /v1/auth/magic-link/verify  {token}           -> tokens
 🔓 POST /v1/auth/passkey/*          (WebAuthn)
 🔓 POST /v1/auth/otp/*              (רק אם המפעיל הפעיל ספק SMS)
 🔓 GET  /v1/instance                (שם, מיתוג, שפות, ספקי Login פעילים – ציבורי)
 🔓 POST /v1/auth/oauth/{apple|google}
 🔓 POST /v1/auth/refresh            (rotation + reuse detection)
 🔐 POST /v1/auth/logout             / logout-all
Profile
 🔐 GET|PATCH /v1/me/profile · GET|PUT /v1/me/preferences · PUT /v1/me/location
 🔐 POST /v1/me/photos/upload-url    -> presigned PUT ל-quarantine
 🔐 POST /v1/me/photos/{id}/confirm  · DELETE /v1/me/photos/{id} · PUT /v1/me/photos/order
 🔐 PUT  /v1/me/prompts
 🔐 GET  /v1/profiles/{userId}       -- רק אם מותר (לא חסום, ב-recs/match), אחרת 404
Discovery & Matching
 🔐 GET  /v1/discover?cursor=        · GET /v1/picks/today
 🔐 POST /v1/interactions            {targetId, kind, itemId?, comment?}
 🔐 GET  /v1/likes/received          · GET /v1/matches · DELETE /v1/matches/{id}
Chat
 🔐 GET  /v1/conversations/{id}/messages?cursor= · POST .../messages · POST .../read
 🔐 WS   /v1/ws                      (auth ב-handshake, events: message, typing, read)
 🔐 POST /v1/conversations/{id}/media-upload-url
AI
 🔐 POST /v1/ai/icebreakers          {matchId}
 🔐 POST /v1/ai/message-check        {text}  -- מקומי, לא נשמר
 🔐 POST /v1/ai/profile-coach        (v0.2, דורש consent ai_cloud אם ספק ענן)
Safety
 🔐 POST /v1/blocks · DELETE /v1/blocks/{id} · POST /v1/reports
 🔐 POST /v1/verification/selfie/session
Privacy
 🔐 GET|PUT /v1/me/consents · POST /v1/me/data-export · DELETE /v1/me (מחיקה, grace 14 יום)
Admin
 🛡️ GET /v1/admin/reports · POST /v1/admin/reports/{id}/resolve · POST /v1/admin/users/{id}/actions
 🛡️ GET|PATCH /v1/admin/instance-settings (מיתוג, מדיניות, ספקים) · POST /v1/setup (פעם אחת בלבד, נעול אחרי השימוש)
 🛡️ GET /v1/admin/audit-logs · GET /v1/admin/verifications
System
 🔓 GET /health · GET /ready
```

**כל endpoint:** ולידציית Zod, בדיקת בעלות (`resource.userId === session.userId`) בשכבת service, בדיקת חסימה הדדית, payload limit (JSON 64KB), שגיאות בפורמט אחיד `{error:{code,message}}` ללא stack trace.

---

## 10. מבנה תיקיות

```
Dateos/
├─ apps/
│  ├─ mobile/            Expo Router: app/(auth) (tabs) chat/[id] ...; src/{components,features,i18n,lib}
│  ├─ api/               src/{modules/<name>/{routes,service,repo,schemas}.ts, plugins, ws, server.ts}
│  ├─ worker/            src/jobs/{media-scan,image-process,embeddings,recs,moderation,deletion}.ts
│  └─ admin/             Next.js app router
├─ packages/
│  ├─ shared/            Zod schemas, types, constants, error codes
│  ├─ db/                Drizzle schema, migrations, seed (נתונים פיקטיביים בלבד)
│  ├─ ai/                providers (hashing, ollama), icebreakers, moderation, matching scoring
│  └─ config/            eslint, tsconfig, prettier
├─ infra/
│  ├─ docker-compose.yml postgres(postgis+pgvector), redis, seaweedfs, clamav, ollama, livekit
│  └─ caddy/             reverse proxy + TLS + security headers
├─ docs/                 PLAN.md, THREAT_MODEL.md, DATA_MAP.md, legal/ (טיוטות), ACCESSIBILITY.md
├─ .github/workflows/    ci.yml (lint, typecheck, test, audit, CodeQL, gitleaks)
├─ .env.example · README.md · CONTRIBUTING.md · SECURITY.md · CODE_OF_CONDUCT.md
```

---

## 11. Threat Model (תקציר — יורחב ב-`docs/THREAT_MODEL.md`)

**נכסים רגישים:** מיקום, תמונות, הודעות פרטיות, מספר טלפון, נטייה מינית/דת (קטגוריה מיוחדת), נתוני אימות פנים, היסטוריית אינטראקציות.

| איום                                          | סיכון   | בקרה                                                                                                                  |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| **Trilateration** – חישוב מיקום מדויק ממרחקים | 🔴 גבוה | עיגול מיקום בשרת (~1 ק"מ grid + jitter קבוע לכל משתמש), הצגת מרחק בדליים ("פחות מ-5 ק"מ"), לעולם לא קואורדינטות ב-API |
| **IDOR/BOLA** – גישה לפרופיל/שיחה של אחר      | 🔴 גבוה | בדיקת בעלות בכל service, UUID, טסטים אוטומטיים ייעודיים לכל endpoint                                                  |
| **חשיפה ע"י בלוק עוקף** – חשבון חדש של מטריד  | 🟠      | Device fingerprint hash, חסימת מספר טלפון, אופציה לחסום אנשי קשר                                                      |
| **Catfishing / בוטים / Romance scam**         | 🔴      | Selfie liveness, rate limits על likes/הודעות, מסווג scam, אימות מכשיר (App Attest / Play Integrity 📘)                |
| **הטרדה ותמונות לא רצויות**                   | 🔴      | NSFW detection, תמונות בצ'אט רק אחרי X הודעות + blur כברירת מחדל, "Are you sure?"                                     |
| **Account takeover / SIM swap**               | 🟠      | Refresh token rotation, התראה על מכשיר חדש, OAuth כחלופה, passkeys בעתיד                                              |
| **SMS pumping (הונאת OTP)**                   | 🟠      | Rate limit לפי מדינה/IP, CAPTCHA אחרי ניסיונות, allowlist קידומות                                                     |
| **קבצים זדוניים**                             | 🟠      | quarantine bucket, ClamAV, אימות magic bytes, re-encode ב-sharp, הגבלת גודל                                           |
| **דליפת EXIF/GPS מתמונות**                    | 🔴      | הסרת metadata מלאה לפני שמירה ב-clean bucket                                                                          |
| **Prompt injection ב-AI** (Bio זדוני)         | 🟡      | תוכן משתמש כ-data בלבד, output מוגבל ומסונן, אין tools/פעולות ל-LLM                                                   |
| **גישת אדמין לרעה**                           | 🟠      | MFA חובה, Least privilege, צפייה בהודעות רק בהקשר דיווח, Audit log בלתי ניתן לשינוי                                   |
| **קטינים**                                    | 🔴      | חסימה מתחת ל-18, דיווח "נראה קטין" בעדיפות עליונה, אימות גיל מתקדם בשלב 2 ⚖️                                          |

---

## 12. פרטיות — Data Map (תקציר)

| מידע                       | מטרה                    | בסיס עיבוד (GDPR)                                                                     | אחסון                                         | שמירה                                      | צד שלישי                 |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ | ------------------------ |
| אימייל / טלפון (אופציונלי) | התחברות, מניעת כפילויות | חוזה                                                                                  | Postgres (hash + מוצפן)                       | עד מחיקת חשבון                             | ספק SMTP / SMS של המפעיל |
| תאריך לידה                 | אימות גיל, סינון        | חוזה / חובה חוקית                                                                     | Postgres                                      | חיי החשבון                                 | —                        |
| תמונות                     | פרופיל                  | חוזה                                                                                  | S3 (מוצפן at rest)                            | עד מחיקה + 30 יום גיבוי                    | —                        |
| מיקום (מעוגל)              | Discovery               | חוזה + הסכמת הרשאת OS                                                                 | Postgres                                      | מתעדכן, ללא היסטוריה                       | —                        |
| הודעות                     | צ'אט                    | חוזה                                                                                  | Postgres (מוצפן at rest)                      | עד unmatch/מחיקה; ראיות דיווח – 12 חודש ⚖️ | —                        |
| נטייה/דת (אופציונלי)       | התאמה                   | **הסכמה מפורשת (Art. 9)** ⚖️                                                          | מוצפן ברמת שדה                                | ניתן למחיקה מיידית                         | —                        |
| Selfie אימות               | אימות שהתמונות אמיתיות  | **הסכמה מפורשת** (השוואה אנושית, ללא תבנית ביומטרית; ייתכן שעדיין ייחשב מידע רגיש) ⚖️ | S3 (quarantine→media), נגיש לצוות עם MFA בלבד | נמחק מיד אחרי החלטה; רשומת סטטוס 24 חודש   | —                        |
| דיווחים + ראיות מהצ'אט     | בטיחות ומודרציה         | אינטרס לגיטימי / חובה חוקית ⚖️                                                        | Postgres                                      | 12 חודש אחרי טיפול ⚖️                      | —                        |
| יומן מודרציה               | עקביות ובקרה            | אינטרס לגיטימי                                                                        | Postgres                                      | 24 חודש ⚖️                                 | —                        |
| Hash של אימייל חסום        | מניעת הרשמה מחדש        | אינטרס לגיטימי ⚖️                                                                     | Postgres (HMAC מפתחי)                         | עד ביטול החסימה                            | —                        |
| אינטראקציות                | המלצות                  | אינטרס לגיטימי / חוזה                                                                 | Postgres                                      | 12 חודש ואז אגרגציה                        | —                        |
| טקסט פרופיל ל-AI ענני      | Coach/Icebreakers       | הסכמה                                                                                 | לא נשמר אצל הספק 📘                           | —                                          | ספק ענן חיצוני (DPA) ⚖️  |
| לוגים                      | אבטחה ותפעול            | אינטרס לגיטימי                                                                        | Loki/קבצים, ללא PII                           | 30–90 יום                                  | —                        |

**ישראל:** חוק הגנת הפרטיות + **תיקון 13** (בתוקף מאוגוסט 2025) – סביר שיחול: חובת יידוע מורחבת, "מידע בעל רגישות מיוחדת" (נטייה מינית, מיקום, ביומטרי), תקנות אבטחת מידע (רמת אבטחה בינונית/גבוהה), אפשרות לחובת מינוי ממונה הגנת פרטיות בשל היקף עיבוד מידע רגיש. ⚖️ **דורש בדיקה משפטית.**
**EU:** סביר שנדרש **DPIA** (מידע מיוחד בהיקף גדול + מיקום + פרופיילינג), נציג באיחוד (Art. 27) אם אין ישות ב-EU, DPA מול כל ספק, SCCs להעברה. כמו כן לבדוק תחולת DSA. ⚖️

---

## 13. עוגיות ו-Trackers

- **אפליקציית מובייל:** ללא SDK פרסום/פיקסלים. אנליטיקה רק self-hosted (PostHog/Plausible self-host) ו**רק אחרי opt-in**. Crash reporting (GlitchTip) – מוצג במסך ההסכמות כאופציונלי. App Tracking Transparency – לא נדרש אם אין tracking 📘.
- **Admin:** עוגיית session חיונית בלבד (`Secure; HttpOnly; SameSite=Strict`).
- **אתר נחיתה (שלב מאוחר):** באנר הסכמה עם "אישור הכל / דחיית הכל / ניהול העדפות", ללא סימון מראש, קישור קבוע "הגדרות פרטיות ועוגיות" ב-Footer, תיעוד הסכמה (זמן, גרסה, קטגוריות, מזהה אקראי).
- Inventory מלא ב-`docs/COOKIES.md` לפני השקה.

---

## 14. נגישות (מובייל + Admin)

- יעד: **WCAG 2.1 AA** + התאמה ל-**ת"י 5568** במסכי Web; במובייל – ההנחיות המקבילות של Apple/Google. ⚖️ (תחולת תקנות הנגישות על אפליקציה – לבדיקה)
- כל רכיב: `accessibilityLabel`/`Role`/`Hint`, יעדי מגע ≥ 44×44, תמיכה ב-Dynamic Type עד 200%, VoiceOver/TalkBack.
- **חלופה למחוות החלקה:** כפתורי Like/Pass גלויים + Accessibility Actions על הכרטיס.
- Reduce Motion – כיבוי אנימציות כרטיסים; אין משמעות בצבע בלבד; ניגודיות ≥ 4.5:1.
- RTL מלא: `I18nManager`, אייקונים כיווניים מתהפכים, תאריכים ומספרים לפי locale.
- תמלול אוטומטי (מקומי) להודעות קוליות ו-Prompts קוליים.
- מסך "הצהרת נגישות" + "הגדרות נגישות" (גודל טקסט, ניגודיות גבוהה, עצירת אנימציות) — לא תחליף לנגישות בקוד.

---

## 15. תוכנית עבודה בשלבים

| שלב                                      | תוכן                                                                                                                      | תוצר                         | בדיקות                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------- |
| **0 – יסודות** ✅                        | Monorepo, Docker Compose, CI (lint/typecheck/test/audit/gitleaks/CodeQL), README, .env.example, SECURITY.md, `install.sh` | `pnpm dev` מרים הכל          | CI ירוק                                       |
| **1 – Auth + פרופיל** ✅                 | OTP/OAuth, sessions, פרופיל, העדפות, העלאת תמונות מלאה (quarantine→scan→sharp→clean), onboarding במובייל, i18n+RTL        | הרשמה עד פרופיל מלא          | IDOR tests, upload tests, e2e (Maestro)       |
| **2 – Discovery + Matching** ✅          | מיקום מעוגל, candidates, embeddings, ציון הדדי, Daily Picks, interactions, matches                                        | Discover + Picks + Likes You | בדיקות דירוג דטרמיניסטיות, trilateration test |
| **3 – Chat** ✅ (3b: קול + push ✅)      | WebSocket, הודעות, מדיה, push, read receipts, offline queue                                                               | צ'אט מלא                     | עומס בסיסי, הרשאות שיחה                       |
| **1.5 – Instance** ✅                    | Setup Wizard, מיתוג (שם/לוגו/צבעים/שפה), instance-settings, Web/PWA build                                                 | מפעיל מקים אתר ממותג         | בדיקת נעילת setup                             |
| **4 – Safety** ✅ (NSFW אוטומטי → בהמשך) | Block/Report, moderation מקומי, "Are you sure?", NSFW, selfie verification, Admin + MFA + audit                           | לוח מודרציה                  | תרחישי abuse                                  |
| **5 – AI** ✅                            | Icebreakers, "למה התאמנו", Profile Coach, scam detection, provider switch                                                 | פיצ'רי AI                    | evals ל-prompts, injection tests              |
| **6 – Privacy & Compliance**             | ייצוא/מחיקה, consents, retention jobs, טיוטות מסמכים משפטיים, הצהרת נגישות                                                | DSAR עובד                    | בדיקת מחיקה מקצה לקצה                         |
| **7 – Hardening & Release**              | Pen-test, ביצועים, a11y audit ידני, App Store/Play review, Checklist פרודקשן                                              | בטא סגורה                    | Checklist מלא                                 |
| **8 – v0.3+**                            | Video dates, Safety check-in, Date planner, Anti-ghosting, אירועים                                                        |                              |                                               |

כל שלב = PR נפרד עם קוד מלא, הוראות הרצה ובדיקות. **מעבר בין שלבים רק באישורך.**

---

## 16. סיכונים ונושאים לבדיקה מקצועית

1. **E2EE בצ'אט** סותר חלקית מודרציה ודיווח עם ראיות. המלצה: MVP עם הצפנה at-rest + דיווח שמצרף הודעות בהסכמת המדווח; E2EE כשלב מאוחר עם "message franking". דורש החלטה.
2. **אימות פנים = מידע ביומטרי** ⚖️ – הסכמה מפורשת, מחיקה מיידית, עדיפות לעיבוד על המכשיר.
3. **App Store / Google Play** – דרישות ל-UGC (דיווח, חסימה, מודרציה, מחיקת חשבון באפליקציה) ולאפליקציות דייטינג 📘.
4. **Cold start** – אפליקציית דייטינג ללא מסה קריטית לא שורדת: השקה גאוגרפית ממוקדת (עיר אחת), מנוע שעובד גם עם מעט נתונים (content-based לפני CF).
5. **עלויות AI** – icebreakers במודל קטן/מקומי, cache, מכסות יומיות.
6. **Email deliverability** – מיילים עלולים להגיע לספאם; ה-Wizard יבדוק SPF/DKIM ויציע Passkeys/OAuth.
7. **מודרציה אנושית** – AI לא מחליף צוות; נדרש תהליך ו-SLA לדיווחים חמורים (קטינים, אלימות) וחובות דיווח לרשויות ⚖️.
8. **אחריות משפטית של מפעיל self-hosted** – כל מי שמריץ instance הוא בעל המאגר; תיעוד ברור ב-README. ⚖️
9. **רישיון MIT** – הוחלט במודע: כל אחד רשאי גם לסגור את הקוד. זה תואם את החזון.
10. **Instances זדוניים** – כל אחד יכול להקים Instance גם לצורך פישינג/איסוף מידע. אין דרך טכנית למנוע בקוד פתוח; נוסיף תיעוד ואזהרות, ומפעילים לגיטימיים יחתמו את האפליקציה שלהם.
11. **מודרציה לכל Instance** – כל מפעיל צריך מודרטורים משלו; נספק כלים טובים + רשימות חסימה משותפות (hash) כאופציה עתידית.

**דורש אישור:** עורך דין פרטיות (ישראל + EU), ממונה הגנת פרטיות, יועץ נגישות, בודק חדירות לפני השקה.

---

## 17. הצעד הבא

1. ✅ רישיון (MIT), מודל (חינם לגמרי), AI (מקומי כברירת מחדל) – הוחלטו.
2. פתוח: שוק השקה ופילוחים – ממשיכים עם הנחות העבודה אם אין שינוי.
3. לאחר אישור: **שלב 0** – Monorepo + Docker Compose + CI + מסמכי פרויקט, כ-PR ראשון.
