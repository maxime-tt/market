/**
 * `create-stepper.test.tsx` — the create form's acceptance stepper.
 *
 * Two layers, both pure: the derivation (`createAcceptanceStepper`) decides each
 * step's status from **that step's own fact**, and the presenter renders what the
 * derivation concluded. `published` is *still reading* — never accepted, never
 * refused; `accepted` is the only phase that completes the acceptance step; a
 * kind-1450 `refused` fails it, in the chain's own words.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreateAcceptanceStepper, createAcceptanceStepper, type ArenaCreateAcceptanceState } from './create-stepper'

const FACTS = {
	eventId: 'create-1',
	coordinate: '1440:seller:lot-1',
	acceptedBy: ['wss://a', 'wss://b'],
	totalRelays: 3,
}

const stepperOf = (state: ArenaCreateAcceptanceState) => createAcceptanceStepper(state)

describe('createAcceptanceStepper — each step rests on its own fact', () => {
	test('published is still reading: publish done, accept active, never complete', () => {
		const stepper = stepperOf({ phase: 'published', ...FACTS })
		expect(stepper.steps.map((step) => [step.key, step.status])).toEqual([
			['publish', 'done'],
			['accept', 'active'],
		])
		expect(stepper.active).toBe('accept')
		expect(stepper.complete).toBe(false)
		// The publish step states the ACK count it actually carries, and calls it storage.
		expect(stepper.steps[0].detail).toContain('2 of 3')
		expect(stepper.steps[0].detail).toContain('storage, not acceptance')
		// The waiting step names the fact and refuses to call an ACK acceptance.
		expect(stepper.steps[1].detail).toContain('arena.createadmit.v1')
		expect(stepper.steps[1].detail).toContain('A relay ACK is not acceptance')
	})

	test('accepted completes both steps and names the height', () => {
		const stepper = stepperOf({ phase: 'accepted', acceptedHeight: 4_210, ...FACTS })
		expect(stepper.steps.map((step) => [step.key, step.status])).toEqual([
			['publish', 'done'],
			['accept', 'done'],
		])
		expect(stepper.active).toBeNull()
		expect(stepper.complete).toBe(true)
		expect(stepper.steps[1].detail).toContain('4,210')
	})

	test('refused fails the acceptance step, with the chain’s words verbatim', () => {
		const stepper = stepperOf({ phase: 'refused', reason: 'title required (max 120 chars)', ...FACTS })
		expect(stepper.steps.map((step) => [step.key, step.status])).toEqual([
			['publish', 'done'],
			['accept', 'failed'],
		])
		expect(stepper.active).toBeNull()
		expect(stepper.complete).toBe(false)
		expect(stepper.steps[1].detail).toBe('the chain refused this listing: title required (max 120 chars)')
	})
})

describe('CreateAcceptanceStepper — the presenter states what the derivation concluded', () => {
	const html = (state: ArenaCreateAcceptanceState): string =>
		renderToStaticMarkup(createElement(CreateAcceptanceStepper, { stepper: stepperOf(state) }))

	test('a still-reading submission animates the acceptance step and is not complete', () => {
		const markup = html({ phase: 'published', ...FACTS })
		expect(markup).toContain('data-slot="arena-create-stepper"')
		expect(markup).toContain('data-active="accept"')
		expect(markup).toContain('data-complete="false"')
		expect(markup).toContain('Relay publish')
		expect(markup).toContain('Chain acceptance')
		expect(markup).toContain('data-step="publish" data-status="done"')
		expect(markup).toContain('data-step="accept" data-status="active"')
	})

	test('an accepted create renders both steps done and complete', () => {
		const markup = html({ phase: 'accepted', acceptedHeight: 4_210, ...FACTS })
		expect(markup).toContain('data-complete="true"')
		expect(markup).toContain('data-active="none"')
		expect(markup).toContain('data-step="accept" data-status="done"')
		expect(markup).toContain('4,210')
	})

	test('a refused create renders the failed acceptance step, in the chain’s words', () => {
		const markup = html({ phase: 'refused', reason: 'startPrice out of range (1..10000000)', ...FACTS })
		expect(markup).toContain('data-step="accept" data-status="failed"')
		expect(markup).toContain('data-complete="false"')
		expect(markup).toContain('the chain refused this listing: startPrice out of range (1..10000000)')
	})
})
