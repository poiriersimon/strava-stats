import axios, { AxiosInstance } from "axios";
import streamDeck from "@elgato/streamdeck";

/**
 * OAuth token storage and management
 */
interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number; // Unix timestamp
	clientId: string;
	clientSecret: string;
}

/**
 * Service for interacting with the Strava API
 */
export class StravaService {
	private readonly baseUrl = "https://www.strava.com/api/v3";
	private readonly authUrl = "https://www.strava.com/oauth";
	private axiosInstance: AxiosInstance;

	/**
	 * Creates a new StravaService instance
	 * @param accessToken - The OAuth access token for the authenticated athlete
	 */
	constructor(private accessToken: string) {
		this.axiosInstance = axios.create({
			baseURL: this.baseUrl,
			headers: {
				Authorization: `Bearer ${this.accessToken}`
			}
		});
	}

	/**
	 * Exchanges an authorization code for access and refresh tokens
	 * @param clientId - Strava app Client ID
	 * @param clientSecret - Strava app Client Secret
	 * @param authCode - Authorization code from OAuth callback
	 * @returns Promise with token response
	 */
	static async exchangeAuthorizationCode(
		clientId: string,
		clientSecret: string,
		authCode: string
	): Promise<TokenResponse> {
		try {
			const response = await axios.post("https://www.strava.com/oauth/token", {
				client_id: clientId,
				client_secret: clientSecret,
				code: authCode,
				grant_type: "authorization_code"
			});
			return response.data;
		} catch (error) {
			throw new Error(`Failed to exchange authorization code: ${error}`);
		}
	}

	/**
	 * Refreshes an expired access token using the refresh token
	 * @param clientId - Strava app Client ID
	 * @param clientSecret - Strava app Client Secret
	 * @param refreshToken - The refresh token
	 * @returns Promise with new token response
	 */
	static async refreshAccessToken(
		clientId: string,
		clientSecret: string,
		refreshToken: string
	): Promise<TokenResponse> {
		try {
			const response = await axios.post("https://www.strava.com/oauth/token", {
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: refreshToken,
				grant_type: "refresh_token"
			});
			return response.data;
		} catch (error) {
			throw new Error(`Failed to refresh access token: ${error}`);
		}
	}

	/**
	 * Gets a valid access token, refreshing if necessary
	 * @returns Promise with valid access token or null if not configured
	 */
	static async getValidAccessToken(): Promise<string | null> {
		try {
			const settings = await streamDeck.settings.getGlobalSettings();
			
			const accessToken = typeof settings.accessToken === 'string' ? settings.accessToken : null;
			const refreshToken = typeof settings.refreshToken === 'string' ? settings.refreshToken : null;
			const clientId = typeof settings.clientId === 'string' ? settings.clientId : null;
			const clientSecret = typeof settings.clientSecret === 'string' ? settings.clientSecret : null;
			const expiresAt = typeof settings.expiresAt === 'number' ? settings.expiresAt : 0;
			
			if (!accessToken || !refreshToken) {
				return null;
			}

			// Check if token is expired (with 5 minute buffer)
			const now = Math.floor(Date.now() / 1000);

			if (expiresAt - 300 > now) {
				// Token is still valid
				return accessToken;
			}

			// Token expired, refresh it
			if (!clientId || !clientSecret) {
				return null;
			}

			const tokenResponse = await this.refreshAccessToken(
				clientId,
				clientSecret,
				refreshToken
			);

			// Save new tokens
			await streamDeck.settings.setGlobalSettings({
				...settings,
				accessToken: tokenResponse.access_token,
				refreshToken: tokenResponse.refresh_token,
				expiresAt: tokenResponse.expires_at
			});

			return tokenResponse.access_token;
		} catch (error) {
			console.error("Failed to get valid access token:", error);
			return null;
		}
	}

	/**
	 * Gets the authenticated athlete's stats
	 * @param athleteId - The athlete's ID
	 * @returns Promise with athlete stats including YTD totals
	 */
	async getAthleteStats(athleteId: number): Promise<AthleteStats> {
		try {
			const response = await this.axiosInstance.get(`/athletes/${athleteId}/stats`);
			return response.data;
		} catch (error) {
			throw new Error(`Failed to fetch athlete stats: ${error}`);
		}
	}

	/**
	 * Gets the authenticated athlete's profile
	 * @returns Promise with athlete profile
	 */
	async getAuthenticatedAthlete(): Promise<Athlete> {
		try {
			const response = await this.axiosInstance.get("/athlete");
			return response.data;
		} catch (error) {
			throw new Error(`Failed to fetch athlete profile: ${error}`);
		}
	}

	/**
	 * Gets the athlete's recent activities
	 * @param page - Page number (default: 1)
	 * @param perPage - Items per page (default: 1 for last activity)
	 * @param after - Unix timestamp to filter activities after this time
	 * @returns Promise with array of activities
	 */
	async getActivities(page: number = 1, perPage: number = 1, after?: number): Promise<Activity[]> {
		try {
			const params: any = {
				page,
				per_page: perPage
			};
			
			if (after) {
				params.after = after;
			}
			
			const response = await this.axiosInstance.get("/athlete/activities", {
				params
			});
			return response.data;
		} catch (error) {
			throw new Error(`Failed to fetch activities: ${error}`);
		}
	}

	/**
	 * Formats distance from meters to kilometers with 2 decimal places
	 */
	static formatDistance(meters: number): string {
		return (meters / 1000).toFixed(2);
	}

	/**
	 * Formats time from seconds to HH:MM:SS
	 */
	static formatTime(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
		}
		return `${minutes}:${secs.toString().padStart(2, "0")}`;
	}

	/**
	 * Calculates pace in min/km
	 */
	static calculatePace(meters: number, seconds: number): string {
		if (meters === 0) return "0:00";
		const kmPerHour = (meters / 1000) / (seconds / 3600);
		const minPerKm = 60 / kmPerHour;
		const minutes = Math.floor(minPerKm);
		const secs = Math.floor((minPerKm - minutes) * 60);
		return `${minutes}:${secs.toString().padStart(2, "0")}`;
	}
}

/**
 * Type definitions for Strava API responses
 */

export interface Athlete {
	id: number;
	username?: string;
	firstname?: string;
	lastname?: string;
	city?: string;
	state?: string;
	country?: string;
	sex?: string;
	premium?: boolean;
}

export interface AthleteStats {
	recent_run_totals: ActivityTotal;
	all_run_totals: ActivityTotal;
	recent_swim_totals: ActivityTotal;
	biggest_ride_distance: number;
	ytd_swim_totals: ActivityTotal;
	all_swim_totals: ActivityTotal;
	recent_ride_totals: ActivityTotal;
	biggest_climb_elevation_gain: number;
	ytd_ride_totals: ActivityTotal;
	all_ride_totals: ActivityTotal;
	ytd_run_totals: ActivityTotal;
}

export interface ActivityTotal {
	count: number;
	distance: number;
	moving_time: number;
	elapsed_time: number;
	elevation_gain: number;
	achievement_count?: number;
}

export interface Activity {
	id: number;
	name: string;
	distance: number;
	moving_time: number;
	elapsed_time: number;
	total_elevation_gain: number;
	type: string;
	sport_type: string;
	start_date: string;
	start_date_local: string;
	average_speed: number;
	max_speed: number;
	average_heartrate?: number;
	max_heartrate?: number;
	achievement_count: number;
	kudos_count: number;
	comment_count: number;
}

export interface TokenResponse {
	token_type: string;
	expires_at: number;
	expires_in: number;
	refresh_token: string;
	access_token: string;
	athlete?: Athlete;
}
