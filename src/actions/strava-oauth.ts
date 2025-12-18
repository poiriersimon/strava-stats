import streamDeck, { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { StravaService } from "../services/strava-service";

/**
 * Strava OAuth Setup action
 * Handles the OAuth authentication flow for Strava
 */
@action({ UUID: "com.simon-poirier.strava-stats.oauth" })
export class StravaOAuth extends SingletonAction<OAuthSettings> {
	override async onWillAppear(ev: WillAppearEvent<OAuthSettings>): Promise<void> {
		// Load settings from global settings to action settings for UI display
		const globalSettings = await streamDeck.settings.getGlobalSettings();
		const settings = ev.payload.settings;
		
		// Sync global settings to action settings if they exist
		if (globalSettings.clientId || globalSettings.clientSecret || globalSettings.accessToken) {
			const updatedSettings: OAuthSettings = {
				...settings,
				clientId: typeof globalSettings.clientId === 'string' ? globalSettings.clientId : settings.clientId,
				clientSecret: typeof globalSettings.clientSecret === 'string' ? globalSettings.clientSecret : settings.clientSecret,
				accessToken: typeof globalSettings.accessToken === 'string' ? globalSettings.accessToken : settings.accessToken,
				refreshToken: typeof globalSettings.refreshToken === 'string' ? globalSettings.refreshToken : settings.refreshToken,
				expiresAt: typeof globalSettings.expiresAt === 'number' ? globalSettings.expiresAt : settings.expiresAt
			};
			
			// Update action settings for UI to display
			for (const action of this.actions) {
				await action.setSettings(updatedSettings);
			}
		}
		
		await this.updateDisplay();
	}

	override async onDidReceiveSettings(ev: any): Promise<void> {
		// When settings change in UI, also save to global settings
		const settings = ev.payload.settings as OAuthSettings;
		
		if (settings.clientId || settings.clientSecret) {
			const globalSettings = await streamDeck.settings.getGlobalSettings();
			await streamDeck.settings.setGlobalSettings({
				...globalSettings,
				clientId: settings.clientId,
				clientSecret: settings.clientSecret
			});
		}
		
		// If authorization code is set and not empty, automatically exchange it
		const authCode = typeof settings.authCode === 'string' ? settings.authCode.trim() : '';
		const clientId = typeof settings.clientId === 'string' ? settings.clientId : '';
		const clientSecret = typeof settings.clientSecret === 'string' ? settings.clientSecret : '';
		
		if (authCode !== '' && clientId && clientSecret) {
			// Check if we haven't already exchanged this code
			const globalSettings = await streamDeck.settings.getGlobalSettings();
			if (!globalSettings.accessToken) {
				await this.exchangeToken(clientId, clientSecret, authCode);
			}
		}
		
		await this.updateDisplay();
	}

	override async onKeyDown(ev: KeyDownEvent<OAuthSettings>): Promise<void> {
		// Refresh the access token when button is pressed
		const globalSettings = await streamDeck.settings.getGlobalSettings();
		
		if (globalSettings.refreshToken) {
			try {
				// Force refresh the token
				const clientId = typeof globalSettings.clientId === 'string' ? globalSettings.clientId : '';
				const clientSecret = typeof globalSettings.clientSecret === 'string' ? globalSettings.clientSecret : '';
				const refreshToken = typeof globalSettings.refreshToken === 'string' ? globalSettings.refreshToken : '';
				
				if (clientId && clientSecret && refreshToken) {
					const tokenResponse = await StravaService.refreshAccessToken(
						clientId,
						clientSecret,
						refreshToken
					);
					
					// Update global settings with new token
					await streamDeck.settings.setGlobalSettings({
						...globalSettings,
						accessToken: tokenResponse.access_token,
						refreshToken: tokenResponse.refresh_token,
						expiresAt: tokenResponse.expires_at
					});
					
					// Update action settings for UI
					for (const action of this.actions) {
						await action.setSettings({
							...ev.payload.settings,
							accessToken: tokenResponse.access_token,
							refreshToken: tokenResponse.refresh_token,
							expiresAt: tokenResponse.expires_at
						});
					}
					
					// Validate API connection (non-blocking)
					const isValid = await this.validateApiConnection(tokenResponse.access_token);
					
					// Show success feedback
					for (const action of this.actions) {
						if (isValid && 'showOk' in action) {
							await action.showOk();
						} else if (!isValid && 'showAlert' in action) {
							await action.showAlert();
						}
					}
				}
			} catch (error) {
				streamDeck.logger.error(`Failed to refresh token: ${error}`);
				// Show alert feedback
				for (const action of this.actions) {
					if ('showAlert' in action) {
						await action.showAlert();
					}
				}
			}
		}
		
		await this.updateDisplay();
	}

	/**
	 * Handle messages from the property inspector
	 */
	override async onSendToPlugin(ev: any): Promise<void> {
		if (ev.payload.event === "exchangeToken") {
			await this.exchangeToken(
				ev.payload.clientId,
				ev.payload.clientSecret,
				ev.payload.authCode
			);
		}
	}

	/**
	 * Exchanges authorization code for tokens
	 */
	private async exchangeToken(clientId: string, clientSecret: string, authCode: string): Promise<void> {
		try {
			// Exchange the authorization code for tokens
			const tokenResponse = await StravaService.exchangeAuthorizationCode(
				clientId,
				clientSecret,
				authCode
			);

			// Save tokens to global settings
			const currentSettings = await streamDeck.settings.getGlobalSettings();
			await streamDeck.settings.setGlobalSettings({
				...currentSettings,
				clientId,
				clientSecret,
				accessToken: tokenResponse.access_token,
				refreshToken: tokenResponse.refresh_token,
				expiresAt: tokenResponse.expires_at,
				athleteId: tokenResponse.athlete?.id
			});

			// Also update action settings for UI to show connected status
			for (const action of this.actions) {
				await action.setSettings({
					clientId,
					clientSecret,
					accessToken: tokenResponse.access_token,
					refreshToken: tokenResponse.refresh_token,
					expiresAt: tokenResponse.expires_at,
					authCode: '' // Clear the auth code after successful exchange
				});
			}

			// Validate API connection (non-blocking)
			const isValid = await this.validateApiConnection(tokenResponse.access_token);

			// Update display
			await this.updateDisplay();

			// Show success/warning on all instances
			for (const action of this.actions) {
				if (isValid && 'showOk' in action) {
					await action.showOk();
				} else if (!isValid && 'showAlert' in action) {
					await action.showAlert();
				}
			}
		} catch (error) {
			console.error("Failed to exchange token:", error);
			// Show alert on all instances
			for (const action of this.actions) {
				if ('showAlert' in action) {
					await action.showAlert();
				}
			}
		}
	}

	/**
	 * Validates the API connection by making a test call
	 * Returns true if successful, false otherwise
	 */
	private async validateApiConnection(accessToken: string): Promise<boolean> {
		try {
			const stravaService = new StravaService(accessToken);
			const athlete = await stravaService.getAuthenticatedAthlete();
			streamDeck.logger.info(`API validation successful - Connected as ${athlete.firstname} ${athlete.lastname}`);
			return true;
		} catch (error) {
			streamDeck.logger.error(`API validation failed: ${error}`);
			return false;
		}
	}

	/**
	 * Updates the button display with connection status
	 */
	private async updateDisplay(): Promise<void> {
		const globalSettings = await streamDeck.settings.getGlobalSettings();

		let title: string;
		if (globalSettings.accessToken && globalSettings.refreshToken) {
			const expiresAt = typeof globalSettings.expiresAt === 'number' ? globalSettings.expiresAt : 0;
			const now = Math.floor(Date.now() / 1000);
			
			if (expiresAt > now) {
				const hoursLeft = Math.floor((expiresAt - now) / 3600);
				title = `✅\nConnected\n${hoursLeft}h left`;
			} else {
				title = "⚠️\nToken\nExpired";
			}
		} else if (globalSettings.clientId && globalSettings.clientSecret) {
			title = "⚙️ Ready\nto Auth";
		} else {
			title = "❌ Not\nConfigured";
		}

		// Update all action instances
		for (const action of this.actions) {
			await action.setTitle(title);
		}
	}
}

/**
 * Settings for the OAuth action
 */
interface OAuthSettings {
	clientId?: string;
	clientSecret?: string;
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	[key: string]: string | number | boolean | undefined;
}
