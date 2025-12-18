import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { StravaService } from "../services/strava-service";

/**
 * Action that displays the most recent Strava activity
 */
@action({ UUID: "com.simon-poirier.strava-stats.last-activity" })
export class LastActivity extends SingletonAction<LastActivitySettings> {
	private refreshInterval?: NodeJS.Timeout;

	/**
	 * Called when the action appears on Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<LastActivitySettings>): Promise<void> {
		const { settings } = ev.payload;

		// Clear any existing interval
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
		}

		// Update immediately
		await this.updateLastActivityDisplay(ev.action.id, settings);

		// Set up periodic refresh (every 30 minutes to respect rate limits)
		this.refreshInterval = setInterval(async () => {
			await this.updateLastActivityDisplay(ev.action.id, settings);
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
	 * Called when button is pressed - refresh the data
	 */
	override async onKeyDown(ev: any): Promise<void> {
		await this.updateLastActivityDisplay(ev.action.id, ev.payload.settings);
	}

	/**
	 * Updates the Stream Deck display with the last activity
	 */
	public async updateLastActivityDisplay(actionId: string, settings: LastActivitySettings): Promise<void> {
		try {
			// Get valid access token (auto-refreshes if needed)
			const accessToken = await StravaService.getValidAccessToken();
			
			if (!accessToken) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle("Setup\nOAuth\nFirst");
				return;
			}

			// Create Strava service and fetch last activity
			const stravaService = new StravaService(accessToken);
			const activities = await stravaService.getActivities(1, 1);

		if (!activities || activities.length === 0) {
			const action = streamDeck.actions.getActionById(actionId);
			if (action) await action.setTitle("No\nActivity");
			return;
		}

		let lastActivity = activities[0];

		// Filter by activity type if specified
		const filterType = settings.filterType;
		if (filterType && filterType !== "all") {
			const filteredActivities = await stravaService.getActivities(1, 10);
			const filtered = filteredActivities.find(a => 
				a.sport_type.toLowerCase().includes(filterType.toLowerCase()) ||
				a.type.toLowerCase().includes(filterType.toLowerCase())
			);
			
			if (!filtered) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle(`No\n${filterType}`);
				return;
			}
			
			// Use the filtered activity
			lastActivity = filtered;
		}			// Format the display based on user preference
			const displayMode = settings.displayMode || "summary";
			let displayText = "";

			switch (displayMode) {
				case "summary":
					const distanceKm = StravaService.formatDistance(lastActivity.distance);
					const time = StravaService.formatTime(lastActivity.moving_time);
					displayText = `LAST\n${distanceKm}km\n${time}`;
					break;

				case "distance":
					const dist = StravaService.formatDistance(lastActivity.distance);
					displayText = `LAST\n${dist}km`;
					break;

				case "pace":
					const pace = StravaService.calculatePace(lastActivity.distance, lastActivity.moving_time);
					displayText = `LAST\nPace\n${pace}/km`;
					break;

				case "time":
					const duration = StravaService.formatTime(lastActivity.moving_time);
					displayText = `LAST\nTime\n${duration}`;
					break;

				case "name":
					// Show activity name (truncate if too long)
					const name = lastActivity.name.length > 20 
						? lastActivity.name.substring(0, 17) + "..." 
						: lastActivity.name;
					displayText = `LAST\n${name}`;
					break;

				case "elevation":
					displayText = `LAST\nElev\n${Math.round(lastActivity.total_elevation_gain)}m`;
					break;

				case "full":
					const fullDist = StravaService.formatDistance(lastActivity.distance);
					const fullTime = StravaService.formatTime(lastActivity.moving_time);
					const fullPace = StravaService.calculatePace(lastActivity.distance, lastActivity.moving_time);
					displayText = `LAST\n${fullDist}km ${fullTime}\n${fullPace}`;
					break;
			}

			// Update the Stream Deck button
			const action = streamDeck.actions.getActionById(actionId);
			if (action) await action.setTitle(displayText);

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
				}
				streamDeck.logger.warn(`Rate limit exceeded for Last Activity - waiting for next refresh cycle`);
			} else {
				if (action) {
					await action.setTitle("Error\nRefresh\nAuth");
				}
				streamDeck.logger.error(`Failed to update last activity: ${JSON.stringify({message: error?.message, status: error?.response?.status, error: error?.toString?.()})}`);
			}
		}
	}
}

/**
 * Settings for the Last Activity action
 */
type LastActivitySettings = {
	filterType?: "all" | "run" | "ride" | "swim";
	displayMode?: "summary" | "distance" | "pace" | "time" | "name" | "elevation" | "full";
};
