import { describe, expect, test } from 'bun:test'
import { arenaParamsRelays } from './arenaParamsRelays'

describe('arenaParamsRelays', () => {
	test('the instance relay alone, when there is one', () => {
		expect(arenaParamsRelays('wss://relay.example', ['wss://a', 'wss://b'])).toEqual(['wss://relay.example'])
	})
	test('the query relays, when there is no instance relay', () => {
		expect(arenaParamsRelays(undefined, ['wss://a', 'wss://b'])).toEqual(['wss://a', 'wss://b'])
		expect(arenaParamsRelays('  ', ['wss://a'])).toEqual(['wss://a'])
	})
})
