import streamDeck, { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, KeyAction, JsonValue } from "@elgato/streamdeck";

import { getCanaryTypesAggregateStatus } from "../crashguard-api";
import { getGlobalConfig } from "../global-config";

interface CanaryMetricsSettings {
	[key: string]: JsonValue;
	canaryTypes?: string[];
	intervalSeconds?: number;
}

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_INTERVAL_SECONDS = 3600;
const IMAGE_SIZE = 144;
const ROW_HEIGHT = IMAGE_SIZE / 3;

const ROWS: { color: string; key: "resolvedCount" | "atRiskCount" | "triggeredCount" }[] = [
	{ color: "#d32f2f", key: "triggeredCount" },
	{ color: "#2e7d32", key: "resolvedCount" },
	{ color: "#f9a825", key: "atRiskCount" },
];

@action({ UUID: "io.crashguard.streamdeck.canary-metrics" })
export class CanaryMetrics extends SingletonAction<CanaryMetricsSettings> {
	private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly settingsCache = new Map<string, CanaryMetricsSettings>();

	override onWillAppear(ev: WillAppearEvent<CanaryMetricsSettings>): void | Promise<void> {
		this.settingsCache.set(ev.action.id, ev.payload.settings);
		this.startPolling(ev.action as KeyAction<CanaryMetricsSettings>);
		return this.refresh(ev.action as KeyAction<CanaryMetricsSettings>, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<CanaryMetricsSettings>): void {
		this.stopPolling(ev.action.id);
		this.settingsCache.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<CanaryMetricsSettings>): void | Promise<void> {
		this.settingsCache.set(ev.action.id, ev.payload.settings);
		return this.refresh(ev.action as KeyAction<CanaryMetricsSettings>, ev.payload.settings);
	}

	private startPolling(actionInstance: KeyAction<CanaryMetricsSettings>): void {
		this.stopPolling(actionInstance.id);
		const timer = setInterval(() => {
			const settings = this.settingsCache.get(actionInstance.id) ?? {};
			void this.refresh(actionInstance, settings);
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

	private async refresh(actionInstance: KeyAction<CanaryMetricsSettings>, settings: CanaryMetricsSettings): Promise<void> {
		const canaryTypes = settings.canaryTypes ?? [];
		if (canaryTypes.length === 0) {
			await this.paint(actionInstance, { resolvedCount: 0, atRiskCount: 0, triggeredCount: 0 });
			return;
		}

		const { engineBaseUrl } = await getGlobalConfig();
		const intervalSeconds = settings.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
		const since = new Date(Date.now() - intervalSeconds * 1000).toISOString();

		try {
			const status = await getCanaryTypesAggregateStatus(engineBaseUrl, canaryTypes, since);
			await this.paint(actionInstance, status);
		} catch (err) {
			streamDeck.logger.error(`CanaryMetrics refresh failed for ${canaryTypes.join(",")}`, err);
		}
	}

	private async paint(
		actionInstance: KeyAction<CanaryMetricsSettings>,
		counts: { resolvedCount: number; atRiskCount: number; triggeredCount: number }
	): Promise<void> {
		const fontSize = 32;
		const rows = ROWS.map(({ color, key }, i) => {
			const y = i * ROW_HEIGHT;
			const textY = y + ROW_HEIGHT / 2 + fontSize * 0.35;
			return `<text x="${IMAGE_SIZE / 2}" y="${textY}" fill="${color}" font-family="-apple-system, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle">${counts[key]}</text>`;
		});

		const dividers = [1, 2].map((i) => {
			const y = i * ROW_HEIGHT;
			return `<line x1="0" y1="${y}" x2="${IMAGE_SIZE}" y2="${y}" stroke="#555555" stroke-width="1" />`;
		});

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SIZE}" height="${IMAGE_SIZE}">
			<rect width="${IMAGE_SIZE}" height="${IMAGE_SIZE}" fill="#2d2d2d" />
			${dividers.join("\n")}
			${rows.join("\n")}
		</svg>`;
		const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await actionInstance.setImage(image);
	}
}
