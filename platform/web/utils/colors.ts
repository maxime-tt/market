export function getHexColorFingerprintFromHexPubkey(pubkey: string): string {
	// Simple hash function to generate a color from the pubkey
	const hash = parseInt(pubkey.slice(0, 6), 16)

	// Convert to HSL color
	const hue = hash % 360
	return `hsl(${hue}, 70%, 50%)`
}

// Generate distinct colors for a list of recipients to avoid color conflicts
export function getDistinctColorsForRecipients(recipients: { pubkey: string }[]): { [pubkey: string]: string } {
	const colorMap: { [pubkey: string]: string } = {}
	const usedHues = new Set<number>()
	const minHueDistance = 30 // Minimum distance between hues to ensure distinctness

	// Predefined distinct colors with good contrast
	const distinctColors = [
		'hsl(0, 70%, 50%)', // Red
		'hsl(240, 70%, 50%)', // Blue
		'hsl(120, 70%, 50%)', // Green
		'hsl(300, 70%, 50%)', // Magenta
		'hsl(60, 70%, 50%)', // Yellow
		'hsl(180, 70%, 50%)', // Cyan
		'hsl(30, 70%, 50%)', // Orange
		'hsl(270, 70%, 50%)', // Purple
		'hsl(210, 70%, 50%)', // Light Blue
		'hsl(330, 70%, 50%)', // Pink
		'hsl(90, 70%, 50%)', // Light Green
		'hsl(150, 70%, 50%)', // Teal
	]

	recipients.forEach((recipient, index) => {
		if (index < distinctColors.length) {
			// Use predefined distinct colors first
			colorMap[recipient.pubkey] = distinctColors[index]
		} else {
			// Generate a unique hue that's sufficiently different from existing ones
			const baseHash = parseInt(recipient.pubkey.slice(0, 6), 16)
			let hue = baseHash % 360

			// Ensure minimum distance from used hues
			let attempts = 0
			while (attempts < 360) {
				const tooClose = Array.from(usedHues).some(
					(usedHue) => Math.abs(hue - usedHue) < minHueDistance || Math.abs(hue - usedHue) > 360 - minHueDistance,
				)

				if (!tooClose) {
					break
				}

				hue = (hue + minHueDistance) % 360
				attempts++
			}

			usedHues.add(hue)
			colorMap[recipient.pubkey] = `hsl(${hue}, 70%, 50%)`
		}
	})

	return colorMap
}
