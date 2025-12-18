import streamDeck from "@elgato/streamdeck";

import { StravaOAuth } from "./actions/strava-oauth";
import { StravaYear } from "./actions/strava-year";
import { StravaMonth } from "./actions/strava-month";
import { StravaWeek } from "./actions/strava-week";
import { LastActivity } from "./actions/last-activity";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register Strava actions
const yearAction = new StravaYear();
const monthAction = new StravaMonth();
const weekAction = new StravaWeek();
const lastActivityAction = new LastActivity();

streamDeck.actions.registerAction(new StravaOAuth());
streamDeck.actions.registerAction(yearAction);
streamDeck.actions.registerAction(monthAction);
streamDeck.actions.registerAction(weekAction);
streamDeck.actions.registerAction(lastActivityAction);

// Listen for system wake events to refresh all trackers
streamDeck.system.onSystemDidWakeUp(async () => {
	streamDeck.logger.info("System woke up - refreshing all visible Strava trackers");
	
	// Refresh all visible action instances
	for (const action of streamDeck.actions) {
		const settings = await action.getSettings();
		
		// Determine which action type and call its refresh method
		if (action.manifestId === "com.simon-poirier.strava-stats.goal") {
			await yearAction.updateYearDisplay(action.id, settings);
		} else if (action.manifestId === "com.simon-poirier.strava-stats.month") {
			await monthAction.updateMonthDisplay(action.id, settings);
		} else if (action.manifestId === "com.simon-poirier.strava-stats.week") {
			await weekAction.updateWeekDisplay(action.id, settings);
		} else if (action.manifestId === "com.simon-poirier.strava-stats.last-activity") {
			await lastActivityAction.updateLastActivityDisplay(action.id, settings);
		}
	}
});

// Finally, connect to the Stream Deck.
streamDeck.connect();
