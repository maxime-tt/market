import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '../primitives/button'
import { Calendar } from '../primitives/calendar'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { pad2, parseDatetimeLocalSeconds, toDatetimeLocal } from '../utils/datetime'

/**
 * Date-and-time picker: a popover whose trigger button shows the chosen instant,
 * opening a single-date `Calendar` plus a `type="time"` field. The two halves are
 * merged into one `datetime-local` string, so the caller keeps a single
 * `value: string` / `onChange: (next: string) => void` contract.
 *
 * Moved verbatim out of the auction-editor monolith (T6.3 slice S2); the date and
 * time helpers now live in `ui/utils/datetime` and are imported from there rather
 * than re-declared locally.
 */
export function DateTimePicker({
	value,
	onChange,
	placeholder = 'Pick a date & time',
}: {
	value: string
	onChange: (next: string) => void
	placeholder?: string
}) {
	const [open, setOpen] = useState(false)
	const seconds = parseDatetimeLocalSeconds(value)
	const date = seconds ? new Date(seconds * 1000) : undefined
	const timeValue = date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : '12:00'

	const handleDateSelect = (next: Date | undefined) => {
		if (!next) return
		const merged = new Date(next)
		if (date) {
			merged.setHours(date.getHours(), date.getMinutes(), 0, 0)
		} else {
			merged.setHours(12, 0, 0, 0)
		}
		onChange(toDatetimeLocal(merged))
	}

	const handleTimeChange = (time: string) => {
		const [hStr, mStr] = time.split(':')
		const h = parseInt(hStr ?? '', 10)
		const m = parseInt(mStr ?? '', 10)
		if (Number.isNaN(h) || Number.isNaN(m)) return
		const base = date ? new Date(date) : new Date()
		base.setHours(h, m, 0, 0)
		onChange(toDatetimeLocal(base))
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button type="button" variant="outline" className="w-full justify-start gap-2 font-normal">
					<CalendarIcon className="h-4 w-4 text-zinc-500 shrink-0" />
					<span className={date ? 'text-zinc-900' : 'text-zinc-500'}>{date ? date.toLocaleString() : placeholder}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar mode="single" selected={date} onSelect={handleDateSelect} captionLayout="dropdown" />
				<div className="border-t p-3 space-y-2">
					<Label htmlFor="datetime-picker-time" className="text-xs text-zinc-600">
						Time
					</Label>
					<Input id="datetime-picker-time" type="time" value={timeValue} onChange={(e) => handleTimeChange(e.target.value)} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
