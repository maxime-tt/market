import { Suspense, type ComponentProps } from 'react'
import { lazyRetry } from '@ui/utils/lazy-retry'

/**
 * The QR scanner, loaded on first use (ADR-0027). `@yudiel/react-qr-scanner`
 * pulls in a barcode detector and webrtc-adapter (~135 KB), so it stays out of
 * the first download and loads when a scanner is actually shown.
 */
const ScannerImpl = lazyRetry(() => import('@yudiel/react-qr-scanner').then((m) => ({ default: m.Scanner })))

export type ScannerProps = ComponentProps<typeof import('@yudiel/react-qr-scanner').Scanner>

export function Scanner(props: ScannerProps) {
	return (
		<Suspense fallback={<div className="aspect-square w-full animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Loading the camera" />}>
			<ScannerImpl {...props} />
		</Suspense>
	)
}
