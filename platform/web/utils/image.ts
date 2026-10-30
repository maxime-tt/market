// Check if an image URL is loadable
export function checkImageLoadable(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		if (!url) {
			resolve(false)
			return
		}

		const img = new Image()
		const timeout = setTimeout(() => resolve(false), 10000)

		const cleanup = (result: boolean) => {
			clearTimeout(timeout)
			resolve(result)
		}

		img.onload = () => cleanup(true)
		img.onerror = () => cleanup(false)
		img.src = url
	})
}
