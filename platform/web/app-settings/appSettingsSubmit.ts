import type { NostrEvent } from '@sdk/core/signer'

/**
 * Client-side app-settings submission (b3-relocate, 2026-10-30; moved verbatim
 * from `src/lib/appSettings.ts` — the server fetch half went to
 * `platform/server/appSettings.ts` and the shared event contract to
 * `sdk/config/app-settings.ts`). The relay publishing does not resolve the
 * promise, so the submission uses a WebSocket to publish the event.
 */

export interface AppSettingsSubmitData {
	instanceName: string
	ownerPk: string
	contactEmail?: string
	logoUrl?: string
	allowRegister: boolean
	defaultCurrency: string
	adminsList: string[]
	relayUrl?: string
}

export async function submitAppSettings(data: NostrEvent): Promise<void> {
	return new Promise((resolve, reject) => {
		const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
		console.log(`Connecting to WebSocket at ${wsUrl}`)

		const ws = new WebSocket(wsUrl)

		// Set up timeout
		const timeoutId = setTimeout(() => {
			ws.close()
			reject(new Error('WebSocket timeout after 10 seconds'))
		}, 10000)

		ws.onopen = () => {
			console.log('WebSocket connected, sending event...')
			// Send the event in Nostr protocol format
			const message = ['EVENT', data]
			ws.send(JSON.stringify(message))
		}

		ws.onmessage = (event) => {
			try {
				const response = JSON.parse(event.data)
				console.log('WebSocket response:', response)

				// Check for OK response
				if (Array.isArray(response) && response[0] === 'OK') {
					const [, eventId, success, message] = response
					if (success) {
						console.log('Event published successfully:', eventId)
						clearTimeout(timeoutId)
						ws.close()
						resolve()
					} else {
						console.error('Event rejected:', message)
						clearTimeout(timeoutId)
						ws.close()
						reject(new Error(`Event rejected: ${message}`))
					}
				}
			} catch (err) {
				console.error('Failed to parse WebSocket response:', err)
			}
		}

		ws.onerror = (error) => {
			console.error('WebSocket error:', error)
			clearTimeout(timeoutId)
			reject(new Error('WebSocket connection failed'))
		}

		ws.onclose = (event) => {
			clearTimeout(timeoutId)
			if (event.code !== 1000) {
				// 1000 is normal closure
				reject(new Error(`WebSocket closed unexpectedly: ${event.code}`))
			}
		}
	})
}
