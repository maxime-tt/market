export { createMemoryEventStore } from './memoryEventStore'
export type { MemoryEventStoreOptions } from './memoryEventStore'
export { createApplesauceEventStore } from './applesauceEventStore'
export type { ApplesauceEventStoreOptions } from './applesauceEventStore'
export { matchesFilter, selectMatching } from './filter'
export type { EventFilter } from './filter'
export {
	DELETION_REQUEST_KIND,
	getDTag,
	getReplaceableKey,
	isAddressableKind,
	isDeletedBy,
	isNewerVersion,
	isReplaceableKind,
	readDeletionTargets,
} from './mergeRules'
export type { DeletionTargets } from './mergeRules'
export type { EventAdmission, EventStoreAddResult, EventStorePort } from './port'
export { buildDeletionLookupFilters, excludeDeleted, readThroughStore } from './read'
export type { EventReadContext } from './read'
