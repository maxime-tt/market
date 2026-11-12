import { CollectionFormContent } from '@platform/web/collections/NewCollectionContent'
import { collectionFormActions } from '@platform/web/collections/collectionFormStore'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/collections/new')({
	component: NewCollectionComponent,
})

function NewCollectionComponent() {
	useDashboardTitle('Create A Collection')

	useEffect(() => {
		// Reset form when component mounts
		collectionFormActions.reset()
	}, [])

	return (
		<div className="space-y-6">
			<CollectionFormContent showFooter={true} />
		</div>
	)
}
