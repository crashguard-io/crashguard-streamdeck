import streamDeck, { JsonObject } from "@elgato/streamdeck";

export interface GlobalConfig extends JsonObject {
	engineBaseUrl: string;
	appBaseUrl: string;
}

const DEFAULTS: GlobalConfig = {
	engineBaseUrl: "http://localhost:5050",
	appBaseUrl: "http://localhost:5173",
};

export async function getGlobalConfig(): Promise<GlobalConfig> {
	const settings = await streamDeck.settings.getGlobalSettings<Partial<GlobalConfig>>();
	return {
		engineBaseUrl: settings.engineBaseUrl || DEFAULTS.engineBaseUrl,
		appBaseUrl: settings.appBaseUrl || DEFAULTS.appBaseUrl,
	};
}
