import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { StravaService } from "../services/strava-service";

/**
 * Action that displays Strava YTD (Year-to-Date) statistics
 */
@action({ UUID: "com.simon-poirier.strava-stats.goal" })
export class StravaYear extends SingletonAction<StravaYearSettings> {
	private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();

	/**
	 * Determines which view to show based on persisted settings
	 */
	private shouldShowGoalProgress(settings: StravaYearSettings): boolean {
		return settings.defaultView === "goal" && !!settings.goal;
	}

	/**
	 * Refreshes the display based on the current persisted settings
	 */
	private async refreshDisplay(actionId: string, settings: StravaYearSettings): Promise<void> {
		if (this.shouldShowGoalProgress(settings)) {
			await this.updateGoalProgressDisplay(actionId, settings);
		} else {
			await this.updateYearDisplay(actionId, settings);
		}
	}

	/**
	 * Called when the action appears on Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<StravaYearSettings>): Promise<void> {
		const actionId = ev.action.id;

		// Clear any existing interval for this specific action
		const existingInterval = this.refreshIntervals.get(actionId);
		if (existingInterval) {
			clearInterval(existingInterval);
		}

		// Fetch the latest persisted settings directly (ev.payload.settings can be stale after sleep/wake)
		const settings = await ev.action.getSettings();
		streamDeck.logger.info(`Year onWillAppear - settings: ${JSON.stringify(settings)}`);

		// Update immediately based on persisted defaultView setting
		await this.refreshDisplay(actionId, settings);

		// Set up periodic refresh (every 30 minutes to respect rate limits)
		const interval = setInterval(async () => {
			const action = streamDeck.actions.getActionById(actionId);
			if (action) {
				const currentSettings = await action.getSettings();
				await this.refreshDisplay(actionId, currentSettings);
			}
		}, 30 * 60 * 1000);
		this.refreshIntervals.set(actionId, interval);
	}

	/**
	 * Called when the action disappears from Stream Deck
	 */
	override onWillDisappear(ev: any): void {
		const actionId = ev.action.id;
		const interval = this.refreshIntervals.get(actionId);
		if (interval) {
			clearInterval(interval);
			this.refreshIntervals.delete(actionId);
		}
	}

	/**
	 * Called when settings change in the property inspector
	 */
	override async onDidReceiveSettings(ev: any): Promise<void> {
		const actionId = ev.action.id;
		const settings = ev.payload.settings;
		streamDeck.logger.info(`Year settings received: ${JSON.stringify(settings)}`);
		await this.refreshDisplay(actionId, settings);
	}

	/**
	 * Called when button is pressed - toggle between current/goal view and persist the choice
	 */
	override async onKeyDown(ev: any): Promise<void> {
		const actionId = ev.action.id;
		const settings = ev.payload.settings;
		const action = ev.action;

		// Toggle the view: if currently showing goal, switch to current; otherwise switch to goal
		const isCurrentlyGoal = this.shouldShowGoalProgress(settings);
		const newView = isCurrentlyGoal ? "current" : "goal";

		// Persist the toggled view to settings so it survives refreshes/restarts
		const newSettings = { ...settings, defaultView: newView };
		await action.setSettings(newSettings);

		// Update display with the new settings
		await this.refreshDisplay(actionId, newSettings);
	}

	/**
	 * Calculates and displays goal progress (ahead/behind/on target)
	 */
	private async updateGoalProgressDisplay(actionId: string, settings: StravaYearSettings): Promise<void> {
		try {
			const accessToken = await StravaService.getValidAccessToken();
			
			if (!accessToken) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle("Setup\nOAuth\nFirst");
				return;
			}

			const stravaService = new StravaService(accessToken);
			const athlete = await stravaService.getAuthenticatedAthlete();
			const stats = await stravaService.getAthleteStats(athlete.id);

			const activityType = settings.activityType || "run";
			let ytdData;

			switch (activityType) {
				case "ride":
					ytdData = stats.ytd_ride_totals;
					break;
				case "swim":
					ytdData = stats.ytd_swim_totals;
					break;
				case "run":
				default:
					ytdData = stats.ytd_run_totals;
					break;
			}

			const goal = settings.goal ? parseFloat(settings.goal.toString()) : 0;
			if (!goal) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle("No Goal\nSet");
				return;
			}

			// Calculate day of year and total days in year
			const now = new Date();
			const startOfYear = new Date(now.getFullYear(), 0, 0);
			const diff = now.getTime() - startOfYear.getTime();
			const oneDay = 1000 * 60 * 60 * 24;
			const dayOfYear = Math.floor(diff / oneDay);
			
			const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
			const daysInYear = isLeapYear(now.getFullYear()) ? 366 : 365;

			// Get current value based on display mode
			const displayMode = settings.displayMode || "distance";
			let currentValue = 0;
			let unit = "";

			switch (displayMode) {
				case "distance":
					currentValue = ytdData.distance / 1000; // Convert to km
					unit = "km";
					break;
				case "time":
					currentValue = ytdData.moving_time / 3600; // Convert to hours for easier comparison
					unit = "h";
					break;
				case "count":
					currentValue = ytdData.count;
					unit = "";
					break;
				case "elevation":
					currentValue = ytdData.elevation_gain;
					unit = "m";
					break;
			}

			// Calculate expected progress based on day of year
			const expectedValue = (goal / daysInYear) * dayOfYear;
			const difference = currentValue - expectedValue;
			const percentProgress = (currentValue / goal) * 100;

			// Determine status
			let statusLine = "";
			let diffLine = "";
			const absDiff = Math.abs(difference);

			if (Math.abs(difference) < (goal * 0.01)) {
				// Within 1% is "on target"
				statusLine = "ON TARGET";
				diffLine = `~${absDiff.toFixed(1)}${unit}`;
			} else if (difference > 0) {
				statusLine = "AHEAD";
				diffLine = `+${absDiff.toFixed(1)}${unit}`;
			} else {
				statusLine = "BEHIND";
				diffLine = `-${absDiff.toFixed(1)}${unit}`;
			}

			// Format current and target lines separately
			const currentFormatted = currentValue.toFixed(1);
			const currentLine = `${currentFormatted}${unit}`;
			const targetLine = `/${goal}${unit}`;

			const displayText = `${statusLine}\n${currentLine}\n${targetLine}\n${diffLine}`;

			const action = streamDeck.actions.getActionById(actionId);
			if (action) {
				await action.setTitle(displayText);
				
				// Set background based on status
				if (difference >= 0) {
					await action.setImage("imgs/keys/background-goalreach");
				} else {
					await action.setImage("imgs/keys/background");
				}
			}

		} catch (error: any) {
			const action = streamDeck.actions.getActionById(actionId);
			if (action) {
				await action.setTitle("Error");
				await action.setImage("imgs/keys/background");
			}
			streamDeck.logger.error(`Failed to update goal progress: ${error?.message}`);
		}
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
	defaultView?: "current" | "goal";
};
