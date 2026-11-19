import { describe, expect, test } from 'bun:test'
import { LOT_MEDIA_MAX_EXTRA, lotGallery, parseLotMedia } from './lotMedia'

describe('lot media', () => {
	test('keeps safe items in order and drops the rest', () => {
		const items = parseLotMedia([
			{ type: 'image', url: ' https://img.example/back.jpg ' },
			{ type: 'video', url: 'https://img.example/demo.mp4' },
			{ type: 'live', url: '/streams/lot.m3u8' },
			{ type: 'image', url: 'http://img.example/plain.jpg' },
			{ type: 'image', url: 'javascript:alert(1)' },
			{ type: 'image', url: '//evil.example/x.jpg' },
			{ type: 'gif', url: 'https://img.example/x.gif' },
			'https://img.example/bare.jpg',
			null,
		])
		expect(items).toEqual([
			{ type: 'image', url: 'https://img.example/back.jpg' },
			{ type: 'video', url: 'https://img.example/demo.mp4' },
			{ type: 'live', url: '/streams/lot.m3u8' },
		])
	})

	test('a non-array is an empty gallery, and the list is capped', () => {
		expect(parseLotMedia(undefined)).toEqual([])
		expect(parseLotMedia('https://img.example/a.jpg')).toEqual([])
		const many = Array.from({ length: 30 }, (_, i) => ({ type: 'image', url: `https://img.example/${i}.jpg` }))
		expect(parseLotMedia(many)).toHaveLength(LOT_MEDIA_MAX_EXTRA)
	})

	test('the gallery puts the main photo first and skips a duplicate of it', () => {
		const main = 'https://img.example/front.jpg'
		expect(
			lotGallery(main, [
				{ type: 'image', url: main },
				{ type: 'image', url: 'https://img.example/side.jpg' },
			]),
		).toEqual([
			{ type: 'image', url: main },
			{ type: 'image', url: 'https://img.example/side.jpg' },
		])
		expect(lotGallery(null, [{ type: 'video', url: 'https://img.example/v.mp4' }])).toEqual([
			{ type: 'video', url: 'https://img.example/v.mp4' },
		])
		expect(lotGallery('javascript:alert(1)', [])).toEqual([])
	})
})
