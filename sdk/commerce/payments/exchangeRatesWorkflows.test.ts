/**
 * BTC exchange-rate read workflow — pins `readBtcExchangeRatesWorkflow` over a fake
 * `BtcExchangeRatesPort`, framework-free and offline (store drain D1, slice 4b).
 *
 * Port semantics (the declared D1 slice-4 delta): ContextVM is tried first; a null/absent answer
 * falls back to Yadio; only a rejection from BOTH surfaces the historic
 * `Failed to fetch BTC exchange rates` error. A Yadio answer of null passes through unchanged
 * (the pre-drain reader cast the Yadio miss through).
 */
import { describe, expect, test } from 'bun:test'
import { readBtcExchangeRatesWorkflow, type BtcExchangeRatesPort } from './exchangeRates'

interface FakePort extends BtcExchangeRatesPort {
	contextVmCalls: number
	yadioCalls: number
}

function createPort(
	contextVm: Record<string, number> | null,
	yadio: Record<string, number> | null,
	options: { rejectYadio?: boolean } = {},
): FakePort {
	const port: FakePort = {
		contextVmCalls: 0,
		yadioCalls: 0,
		fetchContextVmRates: async () => {
			port.contextVmCalls++
			return contextVm
		},
		fetchYadioRates: async () => {
			port.yadioCalls++
			if (options.rejectYadio) throw new Error('yadio down')
			return yadio
		},
	}
	return port
}

describe('readBtcExchangeRatesWorkflow', () => {
	test('returns the ContextVM rates without touching Yadio', async () => {
		const port = createPort({ USD: 100000 }, { USD: 1 })

		expect(await readBtcExchangeRatesWorkflow(port)).toEqual({ USD: 100000 })
		expect(port.yadioCalls).toBe(0)
	})

	test('falls back to Yadio when ContextVM answers null', async () => {
		const port = createPort(null, { USD: 100001 })

		expect(await readBtcExchangeRatesWorkflow(port)).toEqual({ USD: 100001 })
		expect(port.contextVmCalls).toBe(1)
		expect(port.yadioCalls).toBe(1)
	})

	test('both sources failing surfaces the single historic error', async () => {
		const port = createPort(null, null, { rejectYadio: true })

		await expect(readBtcExchangeRatesWorkflow(port)).rejects.toThrow('Failed to fetch BTC exchange rates')
	})

	test('a Yadio answer of null passes through unchanged', async () => {
		const port = createPort(null, null)

		expect(await readBtcExchangeRatesWorkflow(port)).toBeNull()
	})
})
