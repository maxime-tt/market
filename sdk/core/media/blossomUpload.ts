/**
 * The Blossom upload client (BUD-01/BUD-02) — the capability moved out of
 * `src/lib/blossom.ts` and rebuilt over `blossom-client-sdk` (Wave G-a1.1).
 *
 * The signer arrives as an injected port — a plain function over a kind-24242
 * auth event template — because `sdk/` reads no store and imports no host; the
 * platform host (`platform/web/media/blossomUploadHost.ts`) supplies the
 * session capability as this port. The upload runs over plain `fetch`, so
 * upload progress is ADVISORY: `onProgress` stays in the signature but fires at
 * most a completion tick.
 *
 * Declared behavioural deltas against the legacy implementation (A1 §8, red-team
 * F2 — new contract, probed in `blossomUpload.test.ts`):
 * - the server chain is the preferred server FIRST, then the public defaults,
 *   and it is walked even when the preferred server fails (the legacy client
 *   hard-failed on a specified server);
 * - every server gets up to `maxRetries` attempts (the legacy XHR path never
 *   reached its retry helper);
 * - the error surface is the `BLOSSOM_UPLOAD_*` message prefixes, which the
 *   consumers toast verbatim.
 */
import { uploadBlob } from 'blossom-client-sdk/actions/upload'
import { createAuthEvent } from 'blossom-client-sdk/auth'
import { DEFAULT_BLOSSOM_SERVERS } from './blossomServers'

/** Upload attempts per server when the caller does not pin `maxRetries`. */
export const DEFAULT_UPLOAD_ATTEMPTS = 3

/** Error prefix: no server is left to try. */
export const BLOSSOM_UPLOAD_NO_SERVERS = 'BLOSSOM_UPLOAD_NO_SERVERS'
/** Error prefix: every server in the chain failed. */
export const BLOSSOM_UPLOAD_FAILED = 'BLOSSOM_UPLOAD_FAILED'

/** A kind-24242 auth event draft, declared structurally (not borrowed). */
export interface BlossomUploadEventTemplate {
	created_at: number
	kind: number
	content: string
	tags: string[][]
}

/** A signed kind-24242 auth event: the draft plus its id, signature and author. */
export interface BlossomUploadSignedEvent extends BlossomUploadEventTemplate {
	id: string
	sig: string
	pubkey: string
}

/**
 * The signer port: a plain function over an auth-event draft.
 *
 * Structurally identical to the `Signer` function type of the upload library,
 * and to `SignerCapability.signEvent` of the sdk signer module, so a session
 * capability needs no cast to serve as one.
 */
export type BlossomUploadSigner = (draft: BlossomUploadEventTemplate) => Promise<BlossomUploadSignedEvent>

/** The image-metadata tag a NIP-92 `imeta` carries, declared structurally. */
export interface ImetaTag {
	url?: string
	blurhash?: string
	dim?: string
	alt?: string
	m?: string
	x?: string
	size?: string
	fallback?: string[]
	[k: string]: string | string[] | undefined
}

export interface UploadOptions {
	/**
	 * Preferred server URL to use for upload
	 */
	preferredServer?: string
	/**
	 * Callback for upload progress. ADVISORY: the fetch surface has no
	 * upload-progress events, so this fires at most a completion tick.
	 */
	onProgress?: (progress: { loaded: number; total: number }) => void
	/**
	 * Best-effort callback for upload failures (once per failed server)
	 */
	onError?: (error: string, serverUrl?: string) => void
	/**
	 * Maximum number of attempts per server
	 */
	maxRetries?: number
	/**
	 * Enable debug logging
	 */
	debug?: boolean
}

export interface UploadResult {
	imeta: ImetaTag
	url: string
	hash: string
}

/**
 * The upload server chain: the preferred server first, then the public defaults
 * (deduplicated, `plan === 'paid'` excluded — it would only answer 402 without
 * a payment handler).
 */
export function getUploadServerOrder(preferredServer?: string): string[] {
	const publicDefaults = DEFAULT_BLOSSOM_SERVERS.filter((server) => server.plan === 'public').map((server) => server.url)
	return [...new Set([preferredServer, ...publicDefaults].filter((url): url is string => url != null && url !== ''))]
}

/**
 * Upload a file to Blossom servers
 * @param signer - The signing port (the session capability, supplied by the host)
 * @param file - File to upload
 * @param options - Upload options
 * @returns Upload result with imeta and URL
 */
export async function uploadFileToBlossom(signer: BlossomUploadSigner, file: File, options: UploadOptions = {}): Promise<UploadResult> {
	const attemptsPerServer = options.maxRetries ?? DEFAULT_UPLOAD_ATTEMPTS
	const serverOrder = getUploadServerOrder(options.preferredServer)

	if (serverOrder.length === 0) {
		throw new Error(`${BLOSSOM_UPLOAD_NO_SERVERS}: no preferred server and no public defaults`)
	}

	let lastError = 'unknown'
	for (const serverUrl of serverOrder) {
		for (let attempt = 1; attempt <= attemptsPerServer; attempt++) {
			if (options.debug) {
				console.debug(`[BlossomUpload] attempt ${attempt}/${attemptsPerServer} on ${serverUrl}`)
			}

			try {
				const descriptor = await uploadBlob(serverUrl, file, {
					// The library asks for auth on the first 401; the event it gets
					// back is kind 24242 with `t=upload`, scoped to this server and blob.
					onAuth: (server, _sha256, authType, blob) => createAuthEvent(signer, authType, { blobs: [blob], servers: [server] }),
				})

				// The completion tick: no upload-progress events exist on this surface.
				options.onProgress?.({ loaded: file.size, total: file.size })

				const imeta: ImetaTag = {
					url: descriptor.url,
					x: descriptor.sha256,
					size: String(descriptor.size),
				}
				if (descriptor.type) imeta.m = descriptor.type

				return {
					imeta,
					url: descriptor.url,
					hash: descriptor.sha256,
				}
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error)
				if (options.debug) {
					console.debug(`[BlossomUpload] attempt failed on ${serverUrl}: ${lastError}`)
				}
			}
		}
		// The server is exhausted; report it best-effort and walk the chain.
		options.onError?.(lastError, serverUrl)
	}

	throw new Error(`${BLOSSOM_UPLOAD_FAILED}: ${lastError}`)
}
