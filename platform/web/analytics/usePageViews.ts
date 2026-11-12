/**
 * Mounts the page-view reporter. Renders nothing and shows no number.
 *
 * One page view per pathname change, with the query string dropped: `?q=` is a
 * search term and `?p=` is a listing id, and neither may leave the app.
 */

import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { createPageViewReporter, loadAnalyticsConfig, type PageViewReporter } from './pageViews'

let reporter: PageViewReporter | null = null

export function usePageViews(): void {
	const { pathname } = useLocation()

	useEffect(() => {
		let cancelled = false
		void loadAnalyticsConfig().then((config) => {
			if (cancelled) return
			reporter ??= createPageViewReporter(config)
			void reporter.record(pathname)
		})
		return () => {
			cancelled = true
		}
	}, [pathname])
}
