import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPrebuiltShell, servePrebuiltAsset } from './prebuilt'

// ADR-0027: the production server serves the prebuilt split bundle when it exists.
const dir = mkdtempSync(join(tmpdir(), 'prebuilt-'))
mkdirSync(join(dir, '_app'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><script type="module" src="/_app/index-abc.js"></script>')
writeFileSync(join(dir, '_app', 'index-abc.js'), 'console.log(1)')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('prebuilt bundle', () => {
	test('is used when dist/web/index.html exists', async () => {
		const shell = loadPrebuiltShell(dir, {})
		expect(shell).not.toBeNull()
		expect(await shell!.indexHtml.clone().text()).toContain('/_app/index-abc.js')
		expect(Object.keys(shell!.routes)).toEqual(['/_app/:file'])
	})

	test('falls back to runtime bundling when missing or switched off', () => {
		expect(loadPrebuiltShell(join(dir, 'nope'), {})).toBeNull()
		expect(loadPrebuiltShell(dir, { AR_PREBUILT: '0' })).toBeNull()
	})

	test('serves hashed chunks with an immutable cache', async () => {
		const res = await servePrebuiltAsset(dir, 'index-abc.js')
		expect(res.status).toBe(200)
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
	})

	test('refuses traversal and unknown files', async () => {
		for (const name of ['../index.html', '..', '.hidden', 'missing.js', '']) {
			expect((await servePrebuiltAsset(dir, name)).status).toBe(404)
		}
	})
})
