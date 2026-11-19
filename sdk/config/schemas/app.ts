import { z } from 'zod'
import { isSafeHref } from '@sdk/commerce/storefront/storefrontPage'

export const WebUrlSchema = z
	.string()
	.url()
	.refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Must use HTTP or HTTPS')
export const RelayUrlSchema = z
	.string()
	.url()
	.refine((value) => ['ws:', 'wss:'].includes(new URL(value).protocol), 'Must use WS or WSS')

/**
 * An instance's own image reference — the app-settings `picture` and `banner`.
 *
 * These are not arbitrary web URLs. A self-hosted instance must be able to point
 * at its own bundled art (`/images/logo.svg`, served by the app) instead of a
 * third-party marketplace's logo, so the rule is the storefront's own media gate
 * (`isSafeHref`), not a second one: an absolute `https:` URL or an in-app
 * absolute path. `javascript:`, `data:`, `blob:`, bare `http:` and
 * protocol-relative `//host` are all refused.
 */
export const InstanceImageUrlSchema = z
	.string()
	.refine(isSafeHref, { message: 'Must be an https:// URL or an in-app path starting with /' })

export const SocialLinksSchema = z.object({
	twitter: WebUrlSchema.optional(),
	newsletter: WebUrlSchema.optional(),
	telegram: WebUrlSchema.optional(),
	github: WebUrlSchema.optional(),
	nostr: WebUrlSchema.optional(),
})

export const AppSettingsSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	picture: InstanceImageUrlSchema,
	banner: InstanceImageUrlSchema,
	ownerPk: z.string(),
	allowRegister: z.boolean(),
	defaultCurrency: z.string(),
	contactEmail: z
		.string()
		.optional()
		.transform((val) => val || undefined),
	blossom_server: z.string().url().optional(),
	nip96_server: z.string().url().optional(),
	showNostrLink: z.boolean().optional().default(false),
	handlerId: z.string().min(1).optional(),
	siteUrl: WebUrlSchema.optional(),
	publicRelays: z.array(RelayUrlSchema).optional(),
	trustedMints: z.array(WebUrlSchema).optional(),
	bugRelay: RelayUrlSchema.optional(),
	termsUrl: WebUrlSchema.optional(),
	socialLinks: SocialLinksSchema.optional(),
	supportContact: z.string().min(1).optional(),
})

export const ExtendedSettingsSchema = z.object({
	extended_field: z.string().optional(),
})

export type AppSettings = z.infer<typeof AppSettingsSchema>
export type SocialLinks = z.infer<typeof SocialLinksSchema>
export type ExtendedSettings = z.infer<typeof ExtendedSettingsSchema>
