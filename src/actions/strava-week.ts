import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { StravaService } from "../services/strava-service";

/**
 * Action that displays Strava current week statistics
 */
@action({ UUID: "com.simon-poirier.strava-stats.week" })
export class StravaWeek extends SingletonAction<StravaWeekSettings> {
	private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();

	/**
	 * Determines which view to show based on persisted settings
	 */
	private shouldShowGoalProgress(settings: StravaWeekSettings): boolean {
		return settings.defaultView === "goal" && !!settings.goal;
	}

	/**
	 * Refreshes the display based on the current persisted settings
	 */
	private async refreshDisplay(actionId: string, settings: StravaWeekSettings): Promise<void> {
		if (this.shouldShowGoalProgress(settings)) {
			await this.updateGoalProgressDisplay(actionId, settings);
		} else {
			await this.updateWeekDisplay(actionId, settings);
		}
	}

	/**
	 * Called when the action appears on Stream Deck
	 */
	override async onWillAppear(ev: WillAppearEvent<StravaWeekSettings>): Promise<void> {
		const { settings } = ev.payload;
		const actionId = ev.action.id;

		// Clear any existing interval for this specific action
		const existingInterval = this.refreshIntervals.get(actionId);
		if (existingInterval) {
			clearInterval(existingInterval);
		}

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
		streamDeck.logger.info(`Week settings received: ${JSON.stringify(settings)}`);
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
	 * Calculates and displays goal progress (ahead/behind/on target) for the week
	 */
	private async updateGoalProgressDisplay(actionId: string, settings: StravaWeekSettings): Promise<void> {
		try {
			const accessToken = await StravaService.getValidAccessToken();
			
			if (!accessToken) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle("Setup\nOAuth\nFirst");
				return;
			}

			const stravaService = new StravaService(accessToken);
			
			// Get activities for current week (starting Monday)
			const now = new Date();
			const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
			const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
			const monday = new Date(now);
			monday.setDate(now.getDate() - daysFromMonday);
			monday.setHours(0, 0, 0, 0);
			const afterTimestamp = Math.floor(monday.getTime() / 1000);
			
			const activities = await stravaService.getActivities(1, 200, afterTimestamp);

			const activityType = settings.activityType || "run";
			let filteredActivities = activities;
			
			if (activityType !== "all") {
				filteredActivities = activities.filter(a => 
					a.sport_type.toLowerCase().includes(activityType.toLowerCase()) ||
					a.type.toLowerCase().includes(activityType.toLowerCase())
				);
			}

			const weekData = {
				count: filteredActivities.length,
				distance: filteredActivities.reduce((sum, a) => sum + a.distance, 0),
				moving_time: filteredActivities.reduce((sum, a) => sum + a.moving_time, 0),
				elevation_gain: filteredActivities.reduce((sum, a) => sum + a.total_elevation_gain, 0)
			};

			const goal = settings.goal ? parseFloat(settings.goal.toString()) : 0;
			if (!goal) {
				const action = streamDeck.actions.getActionById(actionId);
				if (action) await action.setTitle("No Goal\nSet");
				return;
			}

			// Calculate day of week (1-7, Monday=1)
			const currentDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
			const daysInWeek = 7;

			// Get current value based on display mode
			const displayMode = settings.displayMode || "distance";
			let currentValue = 0;
			let unit = "";

			switch (displayMode) {
				case "distance":
					currentValue = weekData.distance / 1000;
					unit = "km";
					break;
				case "time":
					currentValue = weekData.moving_time / 3600;
					unit = "h";
					break;
				case "count":
					currentValue = weekData.count;
					unit = "";
					break;
				case "elevation":
					currentValue = weekData.elevation_gain;
					unit = "m";
					break;
			}

			// Calculate expected progress based on day of week
			const expectedValue = (goal / daysInWeek) * currentDayOfWeek;
			const difference = currentValue - expectedValue;

			// Determine status
			let statusLine = "";
			let diffLine = "";
			const absDiff = Math.abs(difference);

			if (Math.abs(difference) < (goal * 0.01)) {
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
			streamDeck.logger.error(`Failed to update week goal progress: ${error?.message}`);
		}
	}

	/**
	 * Updates the Stream Deck display with current week progress
	 */
	public async updateWeekDisplay(actionId: string, settings: StravaWeekSettings): Promise<void> {
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
			
			// Get activities for current week (starting Monday)
			const now = new Date();
			const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
			const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust so Monday = 0
			const monday = new Date(now);
			monday.setDate(now.getDate() - daysFromMonday);
			monday.setHours(0, 0, 0, 0);
			const afterTimestamp = Math.floor(monday.getTime() / 1000);
			
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
			const weekData = {
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
					const distanceKm = StravaService.formatDistance(weekData.distance);
					currentValue = weekData.distance / 1000;
					if (goal) {
						displayText = `WEEK\n${label}\n${distanceKm}km\nGoal:${goal}`;
					} else {
						displayText = `WEEK\n${label}\n${distanceKm}km`;
					}
					break;
				case "time":
					const time = StravaService.formatTime(weekData.moving_time);
					currentValue = weekData.moving_time;
					if (goal) {
						const goalTime = StravaService.formatTime(goal);
						displayText = `WEEK\n${label}\n${time}\nGoal:${goalTime}`;
					} else {
						displayText = `WEEK\n${label}\n${time}`;
					}
					break;
				case "count":
					currentValue = weekData.count;
					if (goal) {
						displayText = `WEEK\n${label}\n${weekData.count}\nGoal:${goal}`;
					} else {
						displayText = `WEEK\n${label}\n${weekData.count}`;
					}
					break;
				case "elevation":
					const elevation = Math.round(weekData.elevation_gain);
					currentValue = weekData.elevation_gain;
					if (goal) {
						displayText = `WEEK\n${label}\n${elevation}m\nGoal:${goal}m`;
					} else {
						displayText = `WEEK\n${label}\n${elevation}m`;
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
				streamDeck.logger.warn(`Rate limit exceeded for Week tracker - waiting for next refresh cycle`);
			} else {
				if (action) {
					await action.setTitle("Error\nCheck\nToken");
					await action.setImage("imgs/keys/background");
				}
				streamDeck.logger.error(`Failed to update Strava week: ${JSON.stringify({message: error?.message, status: error?.response?.status, error: error?.toString?.()})}`);
			}
		}
	}
}

/**
 * Settings for the Strava Week action
 */
type StravaWeekSettings = {
	activityType?: "all" | "run" | "ride" | "swim";
	displayMode?: "distance" | "time" | "count" | "elevation";
	goal?: number | string;
	defaultView?: "current" | "goal";
};
