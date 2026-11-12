import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../primitives/tooltip'
import { cn } from '../utils/cn'

interface InfoTooltipProps {
	content: string
	className?: string
}

export function InfoTooltip({ content, className }: InfoTooltipProps) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className={cn('inline-flex items-center justify-center rounded-full w-5 h-5 text-text-mid hover:text-text-high', className)}
						aria-label="More information"
					>
						<Info className="h-4 w-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent className="max-w-75">
					<p className="text-sm">{content}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
