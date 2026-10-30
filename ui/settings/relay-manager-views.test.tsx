import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RelayCardView, RelayManagerView, type RelayRow } from './relay-manager-views'

const connected: RelayRow = { url: 'wss://relay.example.com', status: 'connected' }
const disconnected: RelayRow = { url: 'wss://backup.example.org', status: 'disconnected' }

const commonProps = {
	ndkReady: true,
	showNostrSync: true,
	relayListLoading: false,
	preferencesLoading: false,
	preferencesPending: false,
	saving: false,
	hasUnsavedChanges: false,
	includeAppDefaults: true,
	onLoadFromNostr: () => {},
	onSaveToNostr: () => {},
	onToggleAppDefaults: () => {},
	newRelayUrl: '',
	onNewRelayUrlChange: () => {},
	onAddRelay: () => {},
	addingRelay: false,
	onConnectToDefaults: () => {},
	explicitRelays: [connected],
	outboxRelays: [disconnected],
	onRemoveRelay: () => {},
}

describe('RelayCardView', () => {
	test('renders the relay domain, the raw url, and the kind badge', () => {
		const markup = renderToStaticMarkup(<RelayCardView url={connected.url} type="explicit" status="connected" onRemove={() => {}} />)
		expect(markup).toContain('relay.example.com')
		expect(markup).toContain('wss://relay.example.com')
		expect(markup).toContain('explicit')
		expect(markup).toContain('Connected')
	})

	test('keeps the unparseable url as its own display domain', () => {
		const markup = renderToStaticMarkup(<RelayCardView url="not-a-url" type="outbox" status="disconnected" onRemove={() => {}} />)
		expect(markup).toContain('not-a-url')
		expect(markup).toContain('Disconnected')
	})

	test('offers the remove control for explicit relays with an accessible name', () => {
		const markup = renderToStaticMarkup(<RelayCardView url={connected.url} type="explicit" status="connected" onRemove={() => {}} />)
		expect(markup).toContain('aria-label="Remove wss://relay.example.com"')
	})

	test('outbox relays render without a remove control', () => {
		const markup = renderToStaticMarkup(<RelayCardView url={disconnected.url} type="outbox" status="disconnected" onRemove={() => {}} />)
		expect(markup).not.toContain('aria-label=')
	})
})

describe('RelayManagerView', () => {
	test('renders the waiting card only when the relay connection is not ready', () => {
		const markup = renderToStaticMarkup(<RelayManagerView {...commonProps} ndkReady={false} />)
		expect(markup).toContain('NDK not initialized')
		expect(markup).not.toContain('Add Relay')
	})

	test('hides the Nostr sync card when signed out and keeps the add form', () => {
		const markup = renderToStaticMarkup(<RelayManagerView {...commonProps} showNostrSync={false} />)
		expect(markup).not.toContain('Nostr Sync')
		expect(markup).toContain('Add Relay')
		expect(markup).not.toContain('Include app default relays')
	})

	test('signs-in gate: the sync card, the preferences toggle, and both publish buttons render', () => {
		const markup = renderToStaticMarkup(<RelayManagerView {...commonProps} />)
		expect(markup).toContain('Nostr Sync')
		expect(markup).toContain('Load from Nostr')
		expect(markup).toContain('Save to Nostr')
		expect(markup).toContain('Include app default relays')
	})

	test('the unsaved-changes banner only renders when the host reports drift', () => {
		const without = renderToStaticMarkup(<RelayManagerView {...commonProps} />)
		expect(without).not.toContain('differs from your published Nostr relay list')
		const withDrift = renderToStaticMarkup(<RelayManagerView {...commonProps} hasUnsavedChanges />)
		expect(withDrift).toContain('differs from your published Nostr relay list')
	})

	test('the add button is disabled while the url is blank', () => {
		const markup = renderToStaticMarkup(<RelayManagerView {...commonProps} newRelayUrl="   " />)
		expect(markup).toContain('disabled')
		expect(markup).toContain('>Add<')
	})

	test('the not-connected notice offers the app defaults when no relay is configured', () => {
		const markup = renderToStaticMarkup(<RelayManagerView {...commonProps} explicitRelays={[]} outboxRelays={[]} />)
		expect(markup).toContain('not connected to any relays')
		expect(markup).toContain('Use Default Relays')
	})

	test('renders both relay sections with their counts', () => {
		const markup = renderToStaticMarkup(
			<RelayManagerView {...commonProps} outboxRelays={[disconnected, { ...disconnected, url: 'wss://third.example.net' }]} />,
		)
		expect(markup).toContain('Explicit Relays (1)')
		expect(markup).toContain('Outbox Relays (2)')
	})
})
