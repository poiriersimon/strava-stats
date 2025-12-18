import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { StravaService } from "../services/strava-service";

/**
 * Action that displays Strava YTD (Year-to-Date) statistics
 */
@action({ UUID: "com.simon-poirier.strava-stats.goal" })
export class StravaYear extends SingletonAction<StravaYearSettings> {
	private refreshInterval?: NodeJS.Timeout;

	/**
	 * Called when the action appears on Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<StravaYearSettings>): Promise<void> {
		const { settings } = ev.payload;

		// Clear any existing interval
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
		}

		// Update immediately
		await this.updateYearDisplay(ev.action.id, settings);

		// Set up periodic refresh (every 30 minutes to respect rate limits)
		this.refreshInterval = setInterval(async () => {
			await this.updateYearDisplay(ev.action.id, settings);
		}, 30 * 60 * 1000);
	}

	/**
	 * Called when the action disappears from Stream Deck
	 */
	override onWillDisappear(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = undefined;
		}
	}

	/**
	 * Called when settings change in the property inspector
	 */
	override async onDidReceiveSettings(ev: any): Promise<void> {
		streamDeck.logger.info(`Year settings received: ${JSON.stringify(ev.payload.settings)}`);
		await this.updateYearDisplay(ev.action.id, ev.payload.settings);
	}

	/**
	 * Called when button is pressed - refresh the data
	 */
	override async onKeyDown(ev: any): Promise<void> {
		await this.updateYearDisplay(ev.action.id, ev.payload.settings);
	}

	/**
	 * Updates the Stream Deck display with current year progress
	 */
	public async updateYearDisplay(actionId: string, settings: StravaYearSettings): Promise<void> {
		try {
			// Get valid access token (auto-refreshes if needed)
			const accessToken = await StravaService.getValidAccessToken();
			
			if (!accessToken) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle("Setup\nOAuth\nFirst");
				return;
			}

			// Create Strava service and fetch data
			const stravaService = new StravaService(accessToken);
			const athlete = await stravaService.getAuthenticatedAthlete();
			const stats = await stravaService.getAthleteStats(athlete.id);

			// Determine which activity type to display
			const activityType = settings.activityType || "run";
			let ytdData;
			let label;

			switch (activityType) {
				case "ride":
					ytdData = stats.ytd_ride_totals;
					label = "Ride";
					break;
				case "swim":
					ytdData = stats.ytd_swim_totals;
					label = "Swim";
					break;
				case "run":
				default:
					ytdData = stats.ytd_run_totals;
					label = "Run";
					break;
			}

			// Format the display based on user preference
			const displayMode = settings.displayMode || "distance";
			const goal = settings.goal ? parseFloat(settings.goal.toString()) : undefined;
			let displayText = "";
			let currentValue = 0;

			switch (displayMode) {
				case "distance":
					const distanceKm = StravaService.formatDistance(ytdData.distance);
					currentValue = ytdData.distance / 1000; // Convert to km
					if (goal) {
						displayText = `YEAR\n${label}\n${distanceKm}km\nGoal:${goal}`;
					} else {
						displayText = `YEAR\n${label}\n${distanceKm}km`;
					}
					break;
				case "time":
					const time = StravaService.formatTime(ytdData.moving_time);
					currentValue = ytdData.moving_time;
					if (goal) {
						const goalTime = StravaService.formatTime(goal);
						displayText = `YEAR\n${label}\n${time}\nGoal:${goalTime}`;
					} else {
						displayText = `YEAR\n${label}\n${time}`;
					}
					break;
				case "count":
					currentValue = ytdData.count;
					if (goal) {
						displayText = `YEAR\n${label}\n${ytdData.count}\nGoal:${goal}`;
					} else {
						displayText = `YEAR\n${label}\n${ytdData.count}`;
					}
					break;
				case "elevation":
					const elevation = Math.round(ytdData.elevation_gain);
					currentValue = ytdData.elevation_gain;
					if (goal) {
						displayText = `YEAR\n${label}\n${elevation}m\nGoal:${goal}m`;
					} else {
						displayText = `YEAR\n${label}\n${elevation}m`;
					}
					break;
			}

			// Check if goal is reached and change background image
			const action = streamDeck.actions.getActionById(actionId);
			if (action) {
				await action.setTitle(displayText);
				
				// Change background if goal is set and reached
				if (goal && currentValue >= goal) {
					await action.setImage("imgs/keys/background-goalreach");
				} else {
					await action.setImage("imgs/keys/background");
				}
			}

		} catch (error: any) {
			const action = streamDeck.actions.getActionById(actionId);
			
			// Check if it's a rate limit error (429) - check multiple possible error structures
			const is429 = error?.response?.status === 429 || 
			              error?.status === 429 || 
			              (error?.message && error.message.includes('429')) ||
			              (error?.toString && error.toString().includes('429'));
			
			if (is429) {
				if (action) {
					await action.setTitle("Rate\nLimit\nWait 30m");
					await action.setImage("imgs/keys/background");
				}
				streamDeck.logger.warn(`Rate limit exceeded for Year tracker - waiting for next refresh cycle`);
			} else {
				if (action) {
					await action.setTitle("Error\nCheck\nToken");
					await action.setImage("imgs/keys/background");
				}
				streamDeck.logger.error(`Failed to update Strava year: ${JSON.stringify({message: error?.message, status: error?.response?.status, error: error?.toString?.()})}`);
			}
		}
	}
}

/**
 * Settings for the Strava Year action
 */
type StravaYearSettings = {
	activityType?: "run" | "ride" | "swim";
	displayMode?: "distance" | "time" | "count" | "elevation";
	goal?: number | string;
};
