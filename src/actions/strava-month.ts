import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { StravaService } from "../services/strava-service";

/**
 * Action that displays Strava current month statistics
 */
@action({ UUID: "com.simon-poirier.strava-stats.month" })
export class StravaMonth extends SingletonAction<StravaMonthSettings> {
	private refreshInterval?: NodeJS.Timeout;

	/**
	 * Called when the action appears on Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<StravaMonthSettings>): Promise<void> {
		const { settings } = ev.payload;

		// Clear any existing interval
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
		}

		// Update immediately
		await this.updateMonthDisplay(ev.action.id, settings);

		// Set up periodic refresh (every 30 minutes to respect rate limits)
		this.refreshInterval = setInterval(async () => {
			await this.updateMonthDisplay(ev.action.id, settings);
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
		streamDeck.logger.info(`Month settings received: ${JSON.stringify(ev.payload.settings)}`);
		await this.updateMonthDisplay(ev.action.id, ev.payload.settings);
	}

	/**
	 * Called when button is pressed - refresh the data
	 */
	override async onKeyDown(ev: any): Promise<void> {
		await this.updateMonthDisplay(ev.action.id, ev.payload.settings);
	}

	/**
	 * Updates the Stream Deck display with current month progress
	 */
	public async updateMonthDisplay(actionId: string, settings: StravaMonthSettings): Promise<void> {
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
			
			// Get activities for current month
			const now = new Date();
			const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
			const afterTimestamp = Math.floor(firstDayOfMonth.getTime() / 1000);
			
			const activities = await stravaService.getActivities(1, 200, afterTimestamp);

			// Determine which activity type to filter
			const activityType = settings.activityType || "run";
			let filteredActivities = activities;
			
			if (activityType !== "all") {
				filteredActivities = activities.filter(a => 
					a.sport_type.toLowerCase().includes(activityType.toLowerCase()) ||
					a.type.toLowerCase().includes(activityType.toLowerCase())
				);
			}

			// Calculate totals
			const monthData = {
				count: filteredActivities.length,
				distance: filteredActivities.reduce((sum, a) => sum + a.distance, 0),
				moving_time: filteredActivities.reduce((sum, a) => sum + a.moving_time, 0),
				elevation_gain: filteredActivities.reduce((sum, a) => sum + a.total_elevation_gain, 0)
			};

			// Label based on activity type
			let label = activityType === "all" ? "All" : activityType.charAt(0).toUpperCase() + activityType.slice(1);

			// Format the display based on user preference
			const displayMode = settings.displayMode || "distance";
			const goal = settings.goal ? parseFloat(settings.goal.toString()) : undefined;
			let displayText = "";
			let currentValue = 0;

			switch (displayMode) {
				case "distance":
					const distanceKm = StravaService.formatDistance(monthData.distance);
					currentValue = monthData.distance / 1000;
					if (goal) {
						displayText = `MONTH\n${label}\n${distanceKm}km\nGoal:${goal}`;
					} else {
						displayText = `MONTH\n${label}\n${distanceKm}km`;
					}
					break;
				case "time":
					const time = StravaService.formatTime(monthData.moving_time);
					currentValue = monthData.moving_time;
					if (goal) {
						const goalTime = StravaService.formatTime(goal);
						displayText = `MONTH\n${label}\n${time}\nGoal:${goalTime}`;
					} else {
						displayText = `MONTH\n${label}\n${time}`;
					}
					break;
				case "count":
					currentValue = monthData.count;
					if (goal) {
						displayText = `MONTH\n${label}\n${monthData.count}\nGoal:${goal}`;
					} else {
						displayText = `MONTH\n${label}\n${monthData.count}`;
					}
					break;
				case "elevation":
					const elevation = Math.round(monthData.elevation_gain);
					currentValue = monthData.elevation_gain;
					if (goal) {
						displayText = `MONTH\n${label}\n${elevation}m\nGoal:${goal}m`;
					} else {
						displayText = `MONTH\n${label}\n${elevation}m`;
					}
					break;
			}

			// Update the Stream Deck button with background change
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
				streamDeck.logger.warn(`Rate limit exceeded for Month tracker - waiting for next refresh cycle`);
			} else {
				if (action) {
					await action.setTitle("Error\nCheck\nToken");
					await action.setImage("imgs/keys/background");
				}
				streamDeck.logger.error(`Failed to update Strava month: ${JSON.stringify({message: error?.message, status: error?.response?.status, error: error?.toString?.()})}`);
			}
		}
	}
}

/**
 * Settings for the Strava Month action
 */
type StravaMonthSettings = {
	activityType?: "all" | "run" | "ride" | "swim";
	displayMode?: "distance" | "time" | "count" | "elevation";
	goal?: number | string;
};
