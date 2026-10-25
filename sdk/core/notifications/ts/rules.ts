/**
 * notifications/ts/rules.ts — the rule seam's one helper: run the host's registered rules over one input.
 *
 * The core implements no rule. A rule is the host's: it declares an `id` and a pure `derive` that turns some
 * input into zero or more notifications. `deriveFromRules` is the seam's dispatch — it runs every rule in
 * order and concatenates what they derive — so the platform registers rules (its configuration of what counts
 * as a notification) and the core only carries them.
 */
import type { Notification, NotificationRule } from './types'

/** Run every rule over `input`, concatenating the notifications they derive, in rule order. */
export function deriveFromRules<TInput, TType extends string = string, TPayload = unknown>(
	rules: readonly NotificationRule<TInput, TType, TPayload>[],
	input: TInput,
): Notification<TType, TPayload>[] {
	const derived: Notification<TType, TPayload>[] = []
	for (const rule of rules) derived.push(...rule.derive(input))
	return derived
}
