import streamDeck, { action, SingletonAction, WillAppearEvent, WillDisappearEvent, KeyDownEvent, KeyUpEvent, DidReceiveSettingsEvent, KeyAction, JsonValue } from "@elgato/streamdeck";

import { getCanaryTypeStatus } from "../crashguard-api";
import { getGlobalConfig } from "../global-config";

interface CanaryStatusSettings {
	[key: string]: JsonValue;
	canaryType?: string;
	lastAcknowledgedAt?: string;
}

type StatusColor = "red" | "yellow" | "green" | "unknown";

const POLL_INTERVAL_MS = 10_000;
const LONG_PRESS_MS = 600;
const COLOR_HEX: Record<StatusColor, string> = {
	red: "#d32f2f",
	yellow: "#f9a825",
	green: "#2e7d32",
	unknown: "#616161",
};

@action({ UUID: "io.crashguard.streamdeck.canary-status" })
export class CanaryStatus extends SingletonAction<CanaryStatusSettings> {
	private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly keyDownAt = new Map<string, number>();

	override onWillAppear(ev: WillAppearEvent<CanaryStatusSettings>): void | Promise<void> {
		this.startPolling(ev.action as KeyAction<CanaryStatusSettings>);
		return this.refresh(ev.action as KeyAction<CanaryStatusSettings>, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<CanaryStatusSettings>): void {
		this.stopPolling(ev.action.id);
		this.keyDownAt.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<CanaryStatusSettings>): void | Promise<void> {
		return this.refresh(ev.action as KeyAction<CanaryStatusSettings>, ev.payload.settings);
	}

	override onKeyDown(ev: KeyDownEvent<CanaryStatusSettings>): void {
		this.keyDownAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<CanaryStatusSettings>): Promise<void> {
		const pressedAt = this.keyDownAt.get(ev.action.id);
		this.keyDownAt.delete(ev.action.id);
		const isLongPress = pressedAt !== undefined && Date.now() - pressedAt >= LONG_PRESS_MS;

		const settings = ev.payload.settings;

		if (isLongPress) {
			const acknowledged: CanaryStatusSettings = {
				...settings,
				lastAcknowledgedAt: new Date().toISOString(),
			};
			await ev.action.setSettings(acknowledged);
			await this.refresh(ev.action as KeyAction<CanaryStatusSettings>, acknowledged);
			return;
		}

		if (settings.canaryType) {
			const { appBaseUrl } = await getGlobalConfig();
			await streamDeck.system.openUrl(`${appBaseUrl.replace(/\/$/, "")}/canary-types/${encodeURIComponent(settings.canaryType)}/triggers`);
		}
	}

	private startPolling(actionInstance: KeyAction<CanaryStatusSettings>): void {
		this.stopPolling(actionInstance.id);
		const timer = setInterval(() => {
			void actionInstance.getSettings().then((settings) => this.refresh(actionInstance, settings));
		}, POLL_INTERVAL_MS);
		this.pollers.set(actionInstance.id, timer);
	}

	private stopPolling(actionId: string): void {
		const timer = this.pollers.get(actionId);
		if (timer) {
			clearInterval(timer);
			this.pollers.delete(actionId);
		}
	}

	private async refresh(actionInstance: KeyAction<CanaryStatusSettings>, settings: CanaryStatusSettings): Promise<void> {
		if (!settings.canaryType) {
			await actionInstance.setTitle("");
			await this.paint(actionInstance, "unknown");
			return;
		}

		const { engineBaseUrl } = await getGlobalConfig();
		const since = settings.lastAcknowledgedAt ?? new Date(0).toISOString();

		try {
			const status = await getCanaryTypeStatus(engineBaseUrl, settings.canaryType, since);
			const color: StatusColor = status.triggeredSinceCount > 0 ? "red" : status.atRiskCount > 0 ? "yellow" : "green";
			await actionInstance.setTitle(settings.canaryType);
			await this.paint(actionInstance, color);
		} catch (err) {
			streamDeck.logger.error(`CanaryStatus refresh failed for ${settings.canaryType}`, err);
			await actionInstance.setTitle(settings.canaryType);
			await this.paint(actionInstance, "unknown");
		}
	}

	private async paint(actionInstance: KeyAction<CanaryStatusSettings>, color: StatusColor): Promise<void> {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="${COLOR_HEX[color]}"/></svg>`;
		const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await actionInstance.setImage(image);
	}
}
