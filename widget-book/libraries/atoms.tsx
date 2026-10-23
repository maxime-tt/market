import { InfoTooltip } from '@ui/shared/info-tooltip'
import { Pattern } from '@ui/shared/pattern'
import { SelectableBadge } from '@ui/wrappers/selectable-badge'
import ProgressBar from '@ui/shared/progress-bar'

import type { WidgetLibrary } from '../libraries'

/**
 * Small, data-free components. Each entry renders one deterministic state so a
 * screenshot or assertion is meaningful.
 */
export const atoms: WidgetLibrary = {
	name: 'atoms',
	entries: [
		{
			name: 'SelectableBadge',
			render: () => (
				<div className="flex gap-3">
					<SelectableBadge>Unselected</SelectableBadge>
					<SelectableBadge isSelected>Selected</SelectableBadge>
				</div>
			),
		},
		{
			name: 'ProgressBar',
			render: () => (
				<div className="w-80">
					<ProgressBar progress={64} label="64%" />
				</div>
			),
		},
		{
			name: 'InfoTooltip',
			render: () => <InfoTooltip content="Explains the control" />,
		},
		{
			name: 'Pattern',
			render: () => (
				<div className="relative h-32 w-80 overflow-hidden border bg-background">
					<Pattern pattern="dots" />
				</div>
			),
		},
	],
}
