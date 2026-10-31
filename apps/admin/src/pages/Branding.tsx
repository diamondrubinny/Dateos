// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  MAX_SAFETY_RESOURCES,
  contrastRatio,
  identityVocabularies,
  intentions,
  genders,
  MAX_JOIN_DECLARATION,
  type Gender,
  type Intention,
  isAccessiblePrimary,
  type InstanceSettingsInput,
} from '@nexaheart/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AdminInstanceSettings } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { ErrorBox, Loading, ProtectedImage } from '../components/ui';

type Form = {
  name: string;
  tagline: string;
  primaryColor: string;
  defaultLocale: 'he' | 'en' | 'ar' | 'ru';
  operatorName: string;
  contactEmail: string;
  sponsorUrl: string;
};

const toForm = (s: AdminInstanceSettings): Form => ({
  name: s.name,
  tagline: s.tagline,
  primaryColor: s.primaryColor.toUpperCase(),
  defaultLocale: s.defaultLocale,
  operatorName: s.operatorName ?? '',
  contactEmail: s.contactEmail ?? '',
  sponsorUrl: s.sponsorUrl ?? '',
});

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export function Branding({ wizard, onFinish }: { wizard: boolean; onFinish?: () => void }) {
  const { t } = useLocale();
  const settings = useAsync(() => api.settings(), []);
  /**
   * Phase 62c: a preset changes several cards at once; once the saved values are back, the cards
   * start again from them.
   */
  const [presetVersion, setPresetVersion] = useState(0);
  const remountAfterReload = useRef(false);
  useEffect(() => {
    if (!remountAfterReload.current) return;
    remountAfterReload.current = false;
    setPresetVersion((v) => v + 1);
  }, [settings.data]);
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [notice, setNotice] = useState<string>();
  const [logoKey, setLogoKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (settings.data && !form) setForm(toForm(settings.data));
  }, [settings.data, form]);

  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error) return <ErrorBox error={settings.error} onRetry={settings.reload} />;
  if (!form || !settings.data) return null;

  const validHex = /^#[0-9A-F]{6}$/i.test(form.primaryColor);
  const ratio = validHex ? contrastRatio(form.primaryColor, '#FFFFFF') : 0;
  const readable = validHex && isAccessiblePrimary(form.primaryColor);
  const set = (key: keyof Form) => (value: string) => setForm({ ...form, [key]: value } as Form);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !readable || !form) return;
    setBusy(true);
    setError(undefined);
    try {
      const input: InstanceSettingsInput = {
        name: form.name.trim(),
        tagline: form.tagline.trim(),
        primaryColor: form.primaryColor.toUpperCase(),
        defaultLocale: form.defaultLocale,
        operatorName: orNull(form.operatorName),
        contactEmail: orNull(form.contactEmail),
        sponsorUrl: orNull(form.sponsorUrl),
      };
      await api.saveSettings(input);
      setNotice(wizard ? t.branding.done : t.branding.saved);
      settings.reload();
      statusRef.current?.focus();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    try {
      await api.uploadLogo(file);
      setNotice(t.branding.logoPending);
      setTimeout(() => {
        settings.reload();
        setLogoKey((k) => k + 1);
      }, 3000);
    } catch (err) {
      setError(err as Error);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    try {
      await api.removeLogo();
      settings.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  const field = (key: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <>
      <label htmlFor={`brand-${key}`}>{label}</label>
      <input
        id={`brand-${key}`}
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
        {...props}
      />
    </>
  );

  return (
    <section aria-labelledby="branding-title">
      <h1 id="branding-title">{wizard ? t.branding.wizardTitle : t.branding.title}</h1>
      {wizard ? <p>{t.branding.wizardIntro}</p> : null}
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      {wizard && settings.data.setupCompleted && onFinish ? (
        <button type="button" className="button primary" onClick={onFinish}>
          {t.branding.continue}
        </button>
      ) : null}

      <div className="grid">
        <form className="card" onSubmit={save}>
          {field('name', t.branding.name, { required: true, maxLength: 40 })}
          {field('tagline', t.branding.tagline, { required: true, maxLength: 120 })}

          <label htmlFor="brand-color">{t.branding.color}</label>
          <div className="color-row">
            <input
              type="color"
              aria-label={t.branding.colorPicker}
              value={validHex ? form.primaryColor.toLowerCase() : '#000000'}
              onChange={(e) => set('primaryColor')(e.target.value.toUpperCase())}
            />
            <input
              id="brand-color"
              dir="ltr"
              maxLength={7}
              value={form.primaryColor}
              aria-describedby="brand-color-hint brand-color-status"
              aria-invalid={!readable}
              onChange={(e) => set('primaryColor')(e.target.value.toUpperCase())}
            />
          </div>
          <p id="brand-color-hint" className="help">
            {t.branding.colorHint}
          </p>
          <p
            id="brand-color-status"
            className={readable ? 'contrast-ok' : 'field-error'}
            aria-live="polite"
          >
            {validHex ? format(t.branding.contrast, { ratio: ratio.toFixed(2) }) : '—'} ·{' '}
            {readable ? `✓ ${t.branding.contrastOk}` : `✗ ${t.branding.contrastBad}`}
          </p>

          <label htmlFor="brand-locale">{t.branding.locale}</label>
          <select
            id="brand-locale"
            value={form.defaultLocale}
            onChange={(e) => set('defaultLocale')(e.target.value)}
          >
            <option value="he">עברית</option>
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="ru">Русский</option>
          </select>

          {field('operatorName', t.branding.operator, {
            maxLength: 100,
            autoComplete: 'organization',
          })}
          {field('contactEmail', t.branding.contact, {
            type: 'email',
            dir: 'ltr',
            maxLength: 254,
            autoComplete: 'email',
          })}
          {field('sponsorUrl', `${t.branding.sponsor}`, {
            type: 'url',
            dir: 'ltr',
            maxLength: 300,
            placeholder: 'https://',
          })}

          <button type="submit" className="button primary" disabled={busy || !readable}>
            {t.branding.save}
          </button>
        </form>

        <div>
          <section className="card" aria-labelledby="preview-title">
            <h2 id="preview-title">{t.branding.preview}</h2>
            <div
              className="brand-preview"
              style={{ ['--brand' as string]: validHex ? form.primaryColor : '#000000' }}
            >
              <p className="brand-name">{form.name || '—'}</p>
              <p className="muted">{form.tagline}</p>
              <span className="brand-button">{t.branding.previewButton}</span>
              <span className="brand-link">{t.branding.previewLink}</span>
            </div>
          </section>

          {wizard ? null : <VideoDates settings={settings.data} onSaved={settings.reload} />}
          {wizard ? null : (
            <Presets
              onApplied={() => {
                remountAfterReload.current = true;
                settings.reload();
              }}
            />
          )}
          {wizard ? null : (
            <Identity
              key={`identity-${presetVersion}`}
              settings={settings.data}
              onSaved={settings.reload}
            />
          )}
          {wizard ? null : (
            <CommunityProfile
              key={`community-${presetVersion}`}
              settings={settings.data}
              onSaved={settings.reload}
            />
          )}
          {wizard ? null : (
            <WhoMayJoin
              key={`join-${presetVersion}`}
              settings={settings.data}
              onSaved={settings.reload}
            />
          )}

          <section className="card" aria-labelledby="logo-title">
            <h2 id="logo-title">{t.branding.logo}</h2>
            <p className="help">{t.branding.logoHint}</p>
            {settings.data.logoUrl ? (
              <ProtectedImage
                key={logoKey}
                path={settings.data.logoUrl}
                alt={t.branding.logoAlt}
                className="photo"
              />
            ) : (
              <p className="muted">{t.branding.noLogo}</p>
            )}
            <div className="actions">
              <button type="button" className="button" onClick={() => fileRef.current?.click()}>
                {t.branding.upload}
              </button>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void onLogo(e.target.files?.[0])}
              />
              {settings.data.logoUrl ? (
                <button type="button" className="button" onClick={() => void removeLogo()}>
                  {t.branding.remove}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

/** Video dates (phase 15): off until an admin turns them on, and only if LiveKit is configured. */
function VideoDates({
  settings,
  onSaved,
}: {
  settings: AdminInstanceSettings;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(settings.callsEnabled);
  const [minutes, setMinutes] = useState(String(settings.callMaxMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  const value = Number(minutes);
  const validMinutes = Number.isInteger(value) && value >= 5 && value <= 120;
  const off = !settings.callsConfigured;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || off || !validMinutes) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveSettings({ callsEnabled: enabled, callMaxMinutes: value });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" aria-labelledby="calls-title" onSubmit={save}>
      <h2 id="calls-title">{t.branding.callsTitle}</h2>
      <p className="help" id="calls-hint">
        {off ? t.branding.callsNotConfigured : t.branding.callsHint}
      </p>
      <div className="checkbox">
        <input
          id="calls-enabled"
          type="checkbox"
          checked={enabled}
          disabled={off}
          aria-describedby="calls-hint"
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <label htmlFor="calls-enabled">{t.branding.callsEnable}</label>
      </div>
      <label htmlFor="calls-max">{t.branding.callsMax}</label>
      <input
        id="calls-max"
        type="number"
        inputMode="numeric"
        min={5}
        max={120}
        dir="ltr"
        disabled={off}
        value={minutes}
        aria-invalid={!validMinutes}
        onChange={(e) => setMinutes(e.target.value)}
      />
      <p role="status" className={saved ? 'alert alert-ok' : 'visually-hidden'}>
        {saved ? t.branding.callsSaved : ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={busy || off || !validMinutes}>
        {t.branding.callsSave}
      </button>
    </form>
  );
}

/**
 * Gender identity and pronouns (phase 62a): what this community offers beside the four matching
 * genders. Turning an option off hides it from profiles at once; members' choices are kept.
 */
function Identity({ settings, onSaved }: { settings: AdminInstanceSettings; onSaved: () => void }) {
  const { t } = useLocale();
  const [vocabulary, setVocabulary] = useState(settings.identityVocabulary);
  const [custom, setCustom] = useState(settings.identityCustom);
  const [pronouns, setPronouns] = useState(settings.identityPronouns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveSettings({
        identityVocabulary: vocabulary,
        identityCustom: vocabulary === 'extended' && custom,
        identityPronouns: pronouns,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" aria-labelledby="identity-title" onSubmit={save}>
      <h2 id="identity-title">{t.branding.identityTitle}</h2>
      <p className="help">{t.branding.identityHint}</p>
      <fieldset>
        <legend>{t.branding.identityVocabulary}</legend>
        {identityVocabularies.map((v) => (
          <div key={v} className="radio">
            <input
              type="radio"
              id={`identity-${v}`}
              name="identity-vocabulary"
              checked={vocabulary === v}
              aria-describedby={`identity-${v}-help`}
              onChange={() => setVocabulary(v)}
            />
            <label htmlFor={`identity-${v}`}>{t.branding.identityVocabularies[v]}</label>
            <p id={`identity-${v}-help`} className="help">
              {t.branding.identityVocabularyHelp[v]}
            </p>
          </div>
        ))}
      </fieldset>
      <div className="checkbox">
        <input
          id="identity-custom"
          type="checkbox"
          checked={vocabulary === 'extended' && custom}
          disabled={vocabulary !== 'extended'}
          aria-describedby="identity-custom-help"
          onChange={(e) => setCustom(e.target.checked)}
        />
        <label htmlFor="identity-custom">{t.branding.identityCustom}</label>
      </div>
      <p id="identity-custom-help" className="help">
        {t.branding.identityCustomHelp}
      </p>
      <div className="checkbox">
        <input
          id="identity-pronouns"
          type="checkbox"
          checked={pronouns}
          aria-describedby="identity-pronouns-help"
          onChange={(e) => setPronouns(e.target.checked)}
        />
        <label htmlFor="identity-pronouns">{t.branding.identityPronouns}</label>
      </div>
      <p id="identity-pronouns-help" className="help">
        {t.branding.identityPronounsHelp}
      </p>
      <p role="status" className={saved ? 'alert alert-ok' : 'visually-hidden'}>
        {saved ? t.branding.identitySaved : ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={busy}>
        {t.branding.identitySave}
      </button>
    </form>
  );
}

/**
 * Community profile (phase 62b): which intentions members can choose, and the faith module (faith,
 * stream and observance, with the religion consent). Off and narrowed options are hidden at once;
 * members keep what they chose.
 */
function CommunityProfile({
  settings,
  onSaved,
}: {
  settings: AdminInstanceSettings;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [offered, setOffered] = useState<Intention[]>(settings.intentionsOffered);
  const [faith, setFaith] = useState(settings.faithModule);
  const [afterMatch, setAfterMatch] = useState(settings.photosAfterMatch);
  const [resources, setResources] = useState(settings.safetyResources ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || offered.length === 0) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveSettings({
        intentionsOffered: offered,
        faithModule: faith,
        photosAfterMatch: afterMatch,
        safetyResources: resources.trim() || null,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" aria-labelledby="community-title" onSubmit={save}>
      <h2 id="community-title">{t.branding.communityTitle}</h2>
      <p className="help">{t.branding.communityHint}</p>
      <fieldset aria-describedby="intentions-help">
        <legend>{t.branding.intentionsOffered}</legend>
        {intentions.map((i) => (
          <div key={i} className="checkbox">
            <input
              id={`intention-${i}`}
              type="checkbox"
              checked={offered.includes(i)}
              onChange={(e) =>
                setOffered((list) =>
                  e.target.checked
                    ? intentions.filter((x) => x === i || list.includes(x))
                    : list.filter((x) => x !== i),
                )
              }
            />
            <label htmlFor={`intention-${i}`}>{t.branding.intentions[i]}</label>
          </div>
        ))}
        <p id="intentions-help" className="help" role={offered.length === 0 ? 'alert' : undefined}>
          {offered.length === 0 ? t.branding.intentionsNone : t.branding.intentionsHelp}
        </p>
      </fieldset>
      <div className="checkbox">
        <input
          id="faith-module"
          type="checkbox"
          checked={faith}
          aria-describedby="faith-module-help"
          onChange={(e) => setFaith(e.target.checked)}
        />
        <label htmlFor="faith-module">{t.branding.faithModule}</label>
      </div>
      <p id="faith-module-help" className="help">
        {t.branding.faithModuleHelp}
      </p>
      {/* Phase 66a: text first, as Lex. */}
      <div className="checkbox">
        <input
          id="photos-after-match"
          type="checkbox"
          checked={afterMatch}
          aria-describedby="photos-after-match-help"
          onChange={(e) => setAfterMatch(e.target.checked)}
        />
        <label htmlFor="photos-after-match">{t.branding.photosAfterMatch}</label>
      </div>
      <p id="photos-after-match-help" className="help">
        {t.branding.photosAfterMatchHelp}
      </p>
      {/* Phase 67a: local help members find under Settings → "Help near you". */}
      <label htmlFor="safety-resources">{t.branding.safetyResources}</label>
      <textarea
        id="safety-resources"
        rows={5}
        maxLength={MAX_SAFETY_RESOURCES}
        dir="auto"
        aria-describedby="safety-resources-help"
        value={resources}
        onChange={(e) => setResources(e.target.value)}
      />
      <p id="safety-resources-help" className="help">
        {t.branding.safetyResourcesHelp}
      </p>
      <p role="status" className={saved ? 'alert alert-ok' : 'visually-hidden'}>
        {saved ? t.branding.communitySaved : ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={busy || offered.length === 0}>
        {t.branding.communitySave}
      </button>
    </form>
  );
}

/** Phase 62c: settings for common kinds of community, in one click (every field stays editable). */
const presets = {
  general: {
    identityVocabulary: 'extended',
    identityCustom: false,
    identityPronouns: true,
    intentionsOffered: [...intentions],
    faithModule: false,
    joinMinAge: 18,
    joinMaxAge: null,
  },
  lgbtq: {
    identityVocabulary: 'extended',
    identityCustom: true,
    identityPronouns: true,
    intentionsOffered: [...intentions],
    faithModule: false,
    joinMinAge: 18,
    joinMaxAge: null,
  },
  faithMarriage: {
    identityVocabulary: 'basic',
    identityCustom: false,
    identityPronouns: false,
    intentionsOffered: ['marriage', 'long_term'],
    faithModule: true,
    joinMinAge: 18,
    joinMaxAge: null,
  },
  fiftyPlus: {
    identityVocabulary: 'extended',
    identityCustom: false,
    identityPronouns: true,
    intentionsOffered: ['long_term', 'marriage', 'open', 'friends', 'unsure'],
    faithModule: false,
    joinMinAge: 50,
    joinMaxAge: null,
  },
  friends: {
    identityVocabulary: 'extended',
    identityCustom: false,
    identityPronouns: true,
    intentionsOffered: ['friends'],
    faithModule: false,
    joinMinAge: 18,
    joinMaxAge: null,
  },
} as const satisfies Record<string, InstanceSettingsInput>;
type PresetName = keyof typeof presets;

function Presets({ onApplied }: { onApplied: () => void }) {
  const { t } = useLocale();
  const [choice, setChoice] = useState<PresetName>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [applied, setApplied] = useState(false);

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (!choice || busy) return;
    setBusy(true);
    setError(undefined);
    setApplied(false);
    try {
      const preset = presets[choice];
      await api.saveSettings({ ...preset, intentionsOffered: [...preset.intentionsOffered] });
      setApplied(true);
      onApplied();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" aria-labelledby="presets-title" onSubmit={apply}>
      <h2 id="presets-title">{t.branding.presetsTitle}</h2>
      <p className="help">{t.branding.presetsHint}</p>
      <fieldset>
        <legend>{t.branding.presetsLegend}</legend>
        {(Object.keys(presets) as PresetName[]).map((name) => (
          <div key={name} className="radio">
            <input
              type="radio"
              id={`preset-${name}`}
              name="preset"
              checked={choice === name}
              aria-describedby={`preset-${name}-help`}
              onChange={() => setChoice(name)}
            />
            <label htmlFor={`preset-${name}`}>{t.branding.presets[name].name}</label>
            <p id={`preset-${name}-help`} className="help">
              {t.branding.presets[name].sets}
            </p>
          </div>
        ))}
      </fieldset>
      <p role="status" className={applied ? 'alert alert-ok' : 'visually-hidden'}>
        {applied ? t.branding.presetApplied : ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={!choice || busy}>
        {t.branding.presetApply}
      </button>
    </form>
  );
}

/**
 * Who may join (phase 62c): ages, genders and a declaration, checked when a profile is created.
 * Members already in keep their place. ⚖️ Restricting membership may not be lawful everywhere.
 */
function WhoMayJoin({
  settings,
  onSaved,
}: {
  settings: AdminInstanceSettings;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [min, setMin] = useState(String(settings.joinMinAge));
  const [max, setMax] = useState(settings.joinMaxAge === null ? '' : String(settings.joinMaxAge));
  const [joinGenders, setJoinGenders] = useState<Gender[]>(settings.joinGenders);
  const [declaration, setDeclaration] = useState(settings.joinDeclaration ?? '');
  const [ageCheck, setAgeCheck] = useState(settings.ageCheckRequired);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  const minAge = Number(min);
  const maxAge = max.trim() === '' ? null : Number(max);
  const valid =
    Number.isInteger(minAge) &&
    minAge >= 18 &&
    minAge <= 99 &&
    (maxAge === null || (Number.isInteger(maxAge) && maxAge >= minAge && maxAge <= 100));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.saveSettings({
        joinMinAge: minAge,
        joinMaxAge: maxAge,
        joinGenders,
        joinDeclaration: declaration.trim() === '' ? null : declaration.trim(),
        ...(settings.ageCheckConfigured ? { ageCheckRequired: ageCheck } : {}),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" aria-labelledby="join-title" onSubmit={save}>
      <h2 id="join-title">{t.branding.joinTitle}</h2>
      <p className="help">{t.branding.joinHint}</p>
      <label htmlFor="join-min">{t.branding.joinMinAge}</label>
      <input
        id="join-min"
        type="number"
        inputMode="numeric"
        min={18}
        max={99}
        dir="ltr"
        value={min}
        aria-invalid={!valid}
        onChange={(e) => setMin(e.target.value)}
      />
      <label htmlFor="join-max">{t.branding.joinMaxAge}</label>
      <input
        id="join-max"
        type="number"
        inputMode="numeric"
        min={18}
        max={100}
        dir="ltr"
        value={max}
        aria-invalid={!valid}
        aria-describedby="join-max-help"
        onChange={(e) => setMax(e.target.value)}
      />
      <p id="join-max-help" className="help">
        {t.branding.joinMaxAgeHelp}
      </p>
      <fieldset aria-describedby="join-genders-help">
        <legend>{t.branding.joinGenders}</legend>
        {genders.map((g) => (
          <div key={g} className="checkbox">
            <input
              id={`join-gender-${g}`}
              type="checkbox"
              checked={joinGenders.includes(g)}
              onChange={(e) =>
                setJoinGenders((list) =>
                  e.target.checked
                    ? genders.filter((x) => x === g || list.includes(x))
                    : list.filter((x) => x !== g),
                )
              }
            />
            <label htmlFor={`join-gender-${g}`}>{t.branding.genders[g]}</label>
          </div>
        ))}
        <p id="join-genders-help" className="help">
          {t.branding.joinGendersHelp}
        </p>
      </fieldset>
      <label htmlFor="join-declaration">{t.branding.joinDeclaration}</label>
      <textarea
        id="join-declaration"
        rows={3}
        maxLength={MAX_JOIN_DECLARATION}
        dir="auto"
        aria-describedby="join-declaration-help"
        value={declaration}
        onChange={(e) => setDeclaration(e.target.value)}
      />
      <p id="join-declaration-help" className="help">
        {t.branding.joinDeclarationHelp}
      </p>
      {/* Phase 63: an age check through the server's provider. */}
      <div className="checkbox">
        <input
          id="age-check"
          type="checkbox"
          checked={settings.ageCheckConfigured && ageCheck}
          disabled={!settings.ageCheckConfigured}
          aria-describedby="age-check-help"
          onChange={(e) => setAgeCheck(e.target.checked)}
        />
        <label htmlFor="age-check">{t.branding.ageCheck}</label>
      </div>
      <p id="age-check-help" className="help">
        {settings.ageCheckConfigured ? t.branding.ageCheckHelp : t.branding.ageCheckNotConfigured}
      </p>
      <p role="status" className={saved ? 'alert alert-ok' : 'visually-hidden'}>
        {saved ? t.branding.joinSaved : ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button primary" disabled={busy || !valid}>
        {t.branding.joinSave}
      </button>
    </form>
  );
}
