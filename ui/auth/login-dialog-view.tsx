import { useState, type ReactNode } from 'react'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Dialog, DialogContent } from '../primitives/dialog'
import { Label } from '../primitives/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs'
import { Notice } from '../shared/notice'

export interface LoginDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	privateKeyPanel: ReactNode
	nostrConnectQrPanel: ReactNode
	bunkerPanel: ReactNode
	extensionError: string | null
	onConnectExtension: () => void
	autoLogin: boolean
	onAutoLoginChange: (enabled: boolean) => void
}

// Arena look: the tab rows are segmented pills; arena-chrome.css styles them.
const classNameTab = 'arena-login-tab flex-1 rounded-none shadow-none! after:hidden'

const classNameSubTab = 'arena-login-subtab flex-1 rounded-none shadow-none! after:hidden'

export function LoginDialogView({
	open,
	onOpenChange,
	privateKeyPanel,
	nostrConnectQrPanel,
	bunkerPanel,
	extensionError,
	onConnectExtension,
	autoLogin,
	onAutoLoginChange,
}: LoginDialogViewProps) {
	const [activeTab, setActiveTab] = useState('extension')

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="arena-login sm:max-w-[440px] p-0 gap-0 overflow-hidden"
				data-testid="login-dialog"
			>
				<div className="arena-login-head px-5 sm:px-6 pt-6 pb-5 w-full max-w-full overflow-hidden">
					<p className="arena-login-eyebrow">Nostr sign-in</p>
					<h2 className="arena-login-title">
						Log <em>in</em>
					</h2>
					<p className="arena-login-lede">Choose your preferred login method below.</p>
				</div>
				<div className="px-5 sm:px-6 pt-0 pb-6 w-full max-w-full overflow-hidden">
					<Tabs defaultValue="extension" className="w-full min-w-0 max-w-full" value={activeTab}>
						<TabsList className="arena-login-tabs flex p-0 w-full h-auto">
							<TabsTrigger value="extension" data-testid="extension-tab" className={classNameTab} onClick={() => setActiveTab('extension')}>
								Extension
							</TabsTrigger>
							<TabsTrigger value="connect" data-testid="connect-tab" className={classNameTab} onClick={() => setActiveTab('connect')}>
								N-Connect
							</TabsTrigger>
							<TabsTrigger
								value="private-key"
								data-testid="private-key-tab"
								className={classNameTab}
								onClick={() => setActiveTab('private-key')}
							>
								Private Key
							</TabsTrigger>
						</TabsList>
						<TabsContent value="private-key" className="w-full max-w-full overflow-hidden">
							{privateKeyPanel}
						</TabsContent>
						<TabsContent value="connect" className="w-full max-w-full overflow-hidden">
							<Tabs defaultValue="qr" className="w-full min-w-0 max-w-full">
								<TabsList className="arena-login-subtabs flex p-0 w-full h-auto">
									<TabsTrigger value="qr" data-testid="qr-tab" className={classNameSubTab}>
										QR Code
									</TabsTrigger>
									<TabsTrigger value="bunker" data-testid="bunker-tab" className={classNameSubTab}>
										Bunker URL
									</TabsTrigger>
								</TabsList>
								<TabsContent value="qr" className="w-full max-w-full overflow-hidden">
									{nostrConnectQrPanel}
								</TabsContent>
								<TabsContent value="bunker" className="w-full max-w-full overflow-hidden">
									{bunkerPanel}
								</TabsContent>
							</Tabs>
						</TabsContent>
						<TabsContent value="extension" className="w-full max-w-full overflow-hidden">
							<div className="space-y-4 py-4">
								<p className="text-muted-foreground text-sm">Login using your Nostr browser extension (e.g., Alby, nos2x).</p>
								{extensionError && (
									<Notice tone="error" title="Login Failed">
										{extensionError}
									</Notice>
								)}
								<Button onClick={onConnectExtension} className="w-full" data-testid="connect-extension-button">
									Connect to Extension
								</Button>
							</div>
						</TabsContent>
					</Tabs>
					<div className="flex items-center space-x-2">
						<Label htmlFor="auto-login" className="flex items-center gap-2 text-muted-foreground text-sm">
							<Checkbox
								id="auto-login"
								checked={autoLogin}
								onCheckedChange={(checked) => onAutoLoginChange(checked === true)}
								data-testid="auto-login-checkbox"
							/>
							Auto-login
						</Label>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
