import { z } from 'zod';

export const idSchema = z.uuid();

/** Opaque cursor pagination used by every list endpoint. */
export const paginationQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Languages of the member app. Arabic and Hebrew are right-to-left. */
export const supportedLocales = ['he', 'en', 'ar', 'ru'] as const;
export const localeSchema = z.enum(supportedLocales);
export type Locale = z.infer<typeof localeSchema>;

export const rtlLocales: ReadonlySet<Locale> = new Set(['he', 'ar']);

export function isRtl(locale: Locale): boolean {
  return rtlLocales.has(locale);
}
