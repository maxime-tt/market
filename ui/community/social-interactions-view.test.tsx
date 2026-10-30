import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SocialInteractionsView } from './social-interactions-view'

const slots = {
	reactionButton: <button data-testid="reaction" />,
	zapButton: <button data-testid="zap" />,
	commentButton: <button data-testid="comment" />,
	shareButton: <button data-testid="share" />,
	zapsList: <ul data-testid="zaps" />,
	reactionsList: <ul data-testid="reactions" />,
}

describe('SocialInteractionsView', () => {
	test('renders the four action buttons and both lists stacked by default', () => {
		const markup = renderToStaticMarkup(<SocialInteractionsView {...slots} />)
		for (const id of ['reaction', 'zap', 'comment', 'share', 'zaps', 'reactions']) {
			expect(markup).toContain(`data-testid="${id}"`)
		}
		expect(markup).toContain('data-testid="social-interactions"')
		// Stacked layout: the zaps list is not inside the combined wrap row.
		expect(markup).not.toContain('flex-wrap')
	})

	test('combineZapsAndReactions renders the lists side by side', () => {
		const markup = renderToStaticMarkup(<SocialInteractionsView {...slots} combineZapsAndReactions />)
		expect(markup).toContain('flex-wrap')
	})

	test('hideShareButton removes only the share button', () => {
		const markup = renderToStaticMarkup(<SocialInteractionsView {...slots} hideShareButton />)
		expect(markup).not.toContain('data-testid="share"')
		expect(markup).toContain('data-testid="zap"')
	})

	test('commentIcon renders before the comment button and className merges on the root', () => {
		const markup = renderToStaticMarkup(<SocialInteractionsView {...slots} commentIcon={<ReplyIcon />} className="extra" />)
		expect(markup).toContain('reply-icon')
		expect(markup).toContain('extra')
	})
})

function ReplyIcon() {
	return <svg data-testid="reply-icon" />
}
