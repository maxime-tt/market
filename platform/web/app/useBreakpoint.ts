// Host-layer copy of src/hooks/useBreakpoint.ts, declared in the D3/D4 contract rev 2.3
// and tasks.md row d4-usebreakpoint-platform. src/ cannot re-export a @platform/ hook
// (platform/boundary.test.ts) and sdk/ forbids React, so the 10-line hook is duplicated
// across the retirement boundary until src/hooks/useBreakpoint.ts loses its last src/ consumer.

import { useMedia } from 'react-use'

type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'

export function useBreakpoint(): Breakpoint {
	const isSm = useMedia('(min-width: 640px)', false)
	const isMd = useMedia('(min-width: 768px)', false)
	const isLg = useMedia('(min-width: 1024px)', false)

	if (!isSm) return 'sm'
	if (!isMd) return 'md'
	if (!isLg) return 'lg'
	return 'xl'
}
