import { describe, expect, test, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import React from 'react'
import { Store } from '@tanstack/store'

// Provide a stable, empty auth store so useStore(authStore) does not throw.
const emptyAuthStore = new Store({ user: null })

// Mocks for React Query hooks used by LiveChatPanel.
function baseUseLiveActivity() {
	return {
		data: null,
		dataUpdatedAt: 0,
	}
}

function baseUseLiveChatMessages() {
	return {
		data: [],
	}
}

function baseUsePublishLiveChatMessageMutation() {
	return {
		mutate: () => {},
		isPending: false,
		isSuccess: false,
		isError: false,
		status: 'idle',
	}
}

// Import the real module so we can preserve non-hook exports (fetchLiveActivity)
// while overriding only the hooks. Mocking the entire namespace would shadow
// fetchLiveActivity and break liveChat.test.ts when Bun runs both files together.
const realLiveChat = await import('@platform/web/messaging/liveChatQuery')

mock.module('@platform/web/messaging/liveChatQuery', () => ({
	fetchLiveActivity: realLiveChat.fetchLiveActivity,
	fetchLiveChatMessages: realLiveChat.fetchLiveChatMessages,
	useLiveActivity: () => baseUseLiveActivity(),
	useLiveChatMessages: () => baseUseLiveChatMessages(),
}))

mock.module('@platform/web/messaging/liveChatPublish', () => ({
	usePublishLiveChatMessageMutation: () => baseUsePublishLiveChatMessageMutation(),
}))

// Batch 2 lane D: LiveChatPanel moved to @platform/web/messaging/LiveChatPanel, so it now loads
// the publish binding from its platform home. Single registration since E1b retired the src shim.

const authStoreMock = {
	authStore: emptyAuthStore,
}
mock.module('@platform/web/auth/authStore', () => authStoreMock) // E1b: src shim retired — consumers load the platform store

// LiveChatPanel transitively imports @/lib/utils which imports from
// @platform/web/ndk/ndkStore. Some Bun 1.3.x runners leak module mocks between test
// files, so provide a complete mock here before dynamically importing the
// component.
mock.module('@platform/web/ndk/ndkStore', () => ({
	ndkStore: {
		state: { ndk: null, explicitRelayUrls: [], writeRelayUrls: [], health: 'unknown', connectedRelayCount: 0 },
	},
	ndkActions: {
		getNDK: () => null,
		fetchEventsWithTimeout: mock(async () => new Set()),
		publishEvent: mock(async () => new Set()),
		setSigner: () => {},
		removeSigner: () => {},
		connect: mock(async () => {}),
		initialize: () => null,
	},
	getWriteRelays: () => [],
	// Required by `@platform/web/ndkReadContext`, which the test-label binding now imports
	// statically (store drain D1, slice 3b).
	getAppRelaySet: () => undefined,
	getBugRelay: () => null,
	getMainRelay: () => null,
}))

// Capture React warnings/errors that signal a hooks order violation.
function captureReactErrors(fn: () => void): string[] {
	const originalError = console.error
	const originalWarn = console.warn
	const logs: string[] = []

	console.error = (...args: unknown[]) => {
		logs.push(args.map(String).join(' '))
	}
	console.warn = (...args: unknown[]) => {
		logs.push(args.map(String).join(' '))
	}

	try {
		fn()
	} finally {
		console.error = originalError
		console.warn = originalWarn
	}

	return logs
}

function isHooksOrderError(logs: string[]): boolean {
	return logs.some(
		(log) =>
			log.includes('Rendered fewer hooks than expected') ||
			log.includes('Rendered more hooks than during the previous render') ||
			log.includes('React has detected a change in the order of Hooks'),
	)
}

describe('LiveChatPanel hooks order', () => {
	test('renders with null status without triggering a hooks order warning', async () => {
		const auctionEvent = {
			pubkey: 'a'.repeat(64),
			tags: [
				['d', 'auction:test'],
				['starts', String(Math.floor(Date.now() / 1000) + 3600)],
			],
		} as import('@nostr-dev-kit/ndk').NDKEvent

		const { LiveChatPanel } = await import('@platform/web/messaging/LiveChatPanel')

		const logs = captureReactErrors(() => {
			renderToString(React.createElement(LiveChatPanel, { auctionEvent }))
		})

		expect(isHooksOrderError(logs)).toBe(false)
	})
})
