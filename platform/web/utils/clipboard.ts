import { toast } from 'sonner'

export async function copyToClipboard(data: BlobPart, mimeType = 'text/plain') {
	try {
		if (navigator.clipboard.write) {
			await navigator.clipboard.write([
				new ClipboardItem({
					[mimeType]: new Blob([data], {
						type: mimeType,
					}),
					['text/plain']: new Blob([data], {
						type: 'text/plain',
					}),
				}),
			])
		} else {
			await new Promise((resolve) => {
				resolve(navigator.clipboard.writeText(String(data)))
			})
		}
		toast.success('Copied 👍')
	} catch (e) {
		toast.error(`Error: ${e}`)
		console.log(e)
	}
}
