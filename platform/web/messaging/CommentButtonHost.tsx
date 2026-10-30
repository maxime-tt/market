import { useAuth } from '@platform/web/auth/authStore'
import { CommentButtonView } from '@ui/community/social-buttons'
import { Button } from '@ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/primitives/dialog'
import { Textarea } from '@ui/primitives/textarea'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { ButtonProps } from '@ui/wrappers/button-props'
import type { NDKEvent } from '@platform/web/readContext'

interface CommentButtonHostProps extends ButtonProps {
	event: NDKEvent
	icon?: ReactNode
	tooltip?: string
}

/**
 * Host for the pure `@ui/community/social-buttons` comment button. Moved
 * verbatim from the retiring `src/components/social/CommentButton.tsx`
 * (H-b kit 6 social cluster) onto the platform auth store; the event type
 * arrives through the read facade, so this host names no transport.
 */
export function CommentButtonHost({ event, onClick, ...props }: CommentButtonHostProps) {
	const [dialogOpen, setDialogOpen] = useState(false)
	const [isPosting, setIsPosting] = useState(false)
	const { isAuthenticated } = useAuth()

	const handlePress = (e: MouseEvent<HTMLButtonElement>) => {
		if (onClick) {
			onClick(e)
		} else if (isAuthenticated) {
			setDialogOpen(true)
		} else {
			toast.error('Please log in to comment')
		}
	}

	const handlePostComment = async () => {
		if (!isAuthenticated) {
			toast.error('You must be logged in to comment.')
			return
		}

		// TODO
	}

	return (
		<>
			<CommentButtonView {...props} onPress={handlePress} disabled={props.disabled || !event.ndk} />

			{/* Comment Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Comment on this post</DialogTitle>
						<DialogDescription>Share your thoughts with the community.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<Textarea placeholder="Write your comment here..." className="min-h-[120px] resize-none" rows={6} />
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" onClick={handlePostComment} disabled={isPosting}>
								{isPosting ? 'Posting...' : 'Post Comment'}
							</Button>
						</DialogFooter>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
