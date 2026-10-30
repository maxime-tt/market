import { useAuth } from '@platform/web/auth/authStore'
import { ShareProductDialogView } from '@ui/dialogs/share-product-dialog-view'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface ShareProductDialogHostProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	productId: string
	pubkey: string
	title: string
	/** Signs and publishes the share note; wired by the caller to the publish layer. */
	onPost: (input: { content: string; coordinate: string; url: string }) => Promise<unknown>
}

/**
 * Host for the pure `@ui/dialogs/share-product-dialog-view`. Moved verbatim
 * from the retiring `src/components/dialogs/ShareProductDialog.tsx` (H-b kit 6
 * social cluster — the share button's dialog) onto the platform auth store.
 */
export function ShareProductDialogHost({ open, onOpenChange, productId, pubkey, title, onPost }: ShareProductDialogHostProps) {
	const { isAuthenticated } = useAuth()
	const [shareText, setShareText] = useState('')
	const [isPosting, setIsPosting] = useState(false)
	const [isCopied, setIsCopied] = useState(false)

	// Build the product URL
	const productUrl = typeof window !== 'undefined' ? `${window.location.origin}/products/${productId}` : `/products/${productId}`

	// Generate default share text when dialog opens
	useEffect(() => {
		if (open) {
			const defaultText = `Check out "${title}" on Plebeian!

${productUrl}

#plebeian`
			setShareText(defaultText)
			setIsCopied(false)
		}
	}, [open, title, productUrl])

	const handleCopyUrl = async () => {
		try {
			await navigator.clipboard.writeText(productUrl)
			setIsCopied(true)
			toast.success('URL copied to clipboard!')
			setTimeout(() => setIsCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy URL:', error)
			toast.error('Failed to copy URL')
		}
	}

	const handlePostToNostr = async () => {
		if (!isAuthenticated) {
			toast.error('You must be logged in to post to Nostr')
			return
		}

		setIsPosting(true)
		try {
			await onPost({ content: shareText, coordinate: `30402:${pubkey}:${productId}`, url: productUrl })

			toast.success('Posted to Nostr successfully!')
			onOpenChange(false)
		} catch (error) {
			console.error('Failed to post to Nostr:', error)
			const message = error instanceof Error ? error.message : 'Failed to post to Nostr'
			toast.error(message)
		} finally {
			setIsPosting(false)
		}
	}

	return (
		<ShareProductDialogView
			open={open}
			onOpenChange={onOpenChange}
			canPost={isAuthenticated}
			shareText={shareText}
			onShareTextChange={setShareText}
			isCopied={isCopied}
			isPosting={isPosting}
			onCopyUrl={handleCopyUrl}
			onPost={handlePostToNostr}
		/>
	)
}
