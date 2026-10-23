import { configStore } from '@/lib/stores/config'
import { useStore } from '@tanstack/react-store'
import { useEffect } from 'react'

/**
 * Host wiring: keeps the document title and favicon in sync with the instance's
 * public config. No router dependency, so it can run above the router.
 */
export function useDocumentIdentity() {
	const config = useStore(configStore, (s) => s.config)

	useEffect(() => {
		const instanceName = config?.displayName || config?.name
		if (instanceName) {
			document.title = instanceName
		}

		if (config?.picture) {
			const iconLinks = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')
			iconLinks.forEach((link) => {
				link.href = config.picture as string
			})
		}
	}, [config?.displayName, config?.name, config?.picture])
}
