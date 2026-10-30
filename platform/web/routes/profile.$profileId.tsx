import { ProfilePage } from '@platform/web/profiles/ProfilePage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/profile/$profileId')({
	component: RouteComponent,
})

function RouteComponent() {
	const { profileId } = Route.useParams()
	return <ProfilePage profileId={profileId} />
}
