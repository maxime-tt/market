import { useQuery } from '@tanstack/react-query'
import { createBugRelayReadContext } from '@platform/web/readContext'
import { bugReportKeys, readBugReportsWorkflow, type BugReport as SdkBugReport } from '@sdk/commerce/messaging'

/**
 * platform/web/messaging/bugReportQuery.ts — the React binding for the bug-report read
 * (store drain D1, slice 2).
 *
 * The read logic is framework-free (`readBugReportsWorkflow`, `sdk/commerce/messaging`); this file
 * owns the react-query options and resolves its port from `createBugRelayReadContext()` in
 * `platform/web/readContext.ts`, which pins the fetches to the instance's bug relay (ADR-018),
 * so no part of the read imports `@/lib/stores/ndk`. The query keys are literal-identical to the
 * pre-drain values.
 */

export type BugReport = SdkBugReport

export interface UserProfile {
	pubkey: string
	name?: string
	displayName?: string
	picture?: string
	about?: string
}

export { bugReportKeys }

/**
 * Fetches bug reports (kind 1 events) from the instance's bug relay
 * (ADR-018 `bugRelay`, falling back to the main app relay) with t tag
 * "plebian2beta"
 */
export const fetchBugReports = async (limit: number = 20, until?: number): Promise<BugReport[]> =>
	readBugReportsWorkflow(createBugRelayReadContext(), limit, until)

// React Query options for bug reports
export const bugReportsQueryOptions = (limit: number = 20, until?: number) => ({
	queryKey: bugReportKeys.list(limit, until),
	queryFn: () => fetchBugReports(limit, until),
	staleTime: 5 * 60 * 1000, // 5 minutes
})

// Hooks
export const useBugReports = (limit: number = 20, until?: number) => {
	return useQuery(bugReportsQueryOptions(limit, until))
}
