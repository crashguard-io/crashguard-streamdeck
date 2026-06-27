import streamDeck, { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, KeyAction, JsonValue } from "@elgato/streamdeck";

import { getCanaryTypesAggregateStatus, type CanaryTypeAggregateStatus } from "../crashguard-api";
import { getGlobalConfig } from "../global-config";

interface CanaryGraphSettings {
	[key: string]: JsonValue;
	canaryTypes?: string[];
}

const POLL_INTERVAL_MS = 10_000;
const IMAGE_SIZE = 144;
const CHART_HEIGHT = IMAGE_SIZE / 2;
const CHART_TOP = IMAGE_SIZE - CHART_HEIGHT;

const SUB_BAR_WIDTH = 5;
const SUB_BAR_GAP = 1;
const GROUP_GAP = 4;
// Memory cap only - paint() decides how many of these actually fit on screen, since group width varies.
const MAX_HISTORY = Math.ceil(IMAGE_SIZE / (SUB_BAR_WIDTH + GROUP_GAP)) * 2;

const COLORS = {
	pending: "#1976d2",
	resolved: "#2e7d32",
	atRisk: "#f9a825",
	triggered: "#d32f2f",
	baseline: "#3a3a3a",
};

interface HistoryPoint {
	status: CanaryTypeAggregateStatus;
	tick: number;
}

@action({ UUID: "io.crashguard.streamdeck.canary-graph" })
export class CanaryGraph extends SingletonAction<CanaryGraphSettings> {
	private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly history = new Map<string, HistoryPoint[]>();
	private readonly lastPolledAt = new Map<string, string>();
	private readonly tickCounter = new Map<string, number>();
	private readonly settingsCache = new Map<string, CanaryGraphSettings>();

	override onWillAppear(ev: WillAppearEvent<CanaryGraphSettings>): void | Promise<void> {
		this.settingsCache.set(ev.action.id, ev.payload.settings);
		this.startPolling(ev.action as KeyAction<CanaryGraphSettings>);
		return this.refresh(ev.action as KeyAction<CanaryGraphSettings>, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<CanaryGraphSettings>): void {
		this.stopPolling(ev.action.id);
		this.history.delete(ev.action.id);
		this.lastPolledAt.delete(ev.action.id);
		this.tickCounter.delete(ev.action.id);
		this.settingsCache.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<CanaryGraphSettings>): void | Promise<void> {
		const previous = this.settingsCache.get(ev.action.id);
		const previousTypes = JSON.stringify(previous?.canaryTypes ?? []);
		const nextTypes = JSON.stringify(ev.payload.settings.canaryTypes ?? []);

		this.settingsCache.set(ev.action.id, ev.payload.settings);

		if (previousTypes === nextTypes) {
			// Settings event fired without a real change (e.g. our own getSettings() echoing back) - don't reset the chart.
			return;
		}

		this.history.delete(ev.action.id);
		this.lastPolledAt.delete(ev.action.id);
		this.tickCounter.delete(ev.action.id);
		return this.refresh(ev.action as KeyAction<CanaryGraphSettings>, ev.payload.settings);
	}

	private startPolling(actionInstance: KeyAction<CanaryGraphSettings>): void {
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

	private async refresh(actionInstance: KeyAction<CanaryGraphSettings>, settings: CanaryGraphSettings): Promise<void> {
		const canaryTypes = settings.canaryTypes ?? [];
		if (canaryTypes.length === 0) {
			await this.paint(actionInstance, []);
			return;
		}

		const { engineBaseUrl } = await getGlobalConfig();
		const since = this.lastPolledAt.get(actionInstance.id) ?? new Date(Date.now() - POLL_INTERVAL_MS).toISOString();
		const now = new Date().toISOString();

		try {
			const status = await getCanaryTypesAggregateStatus(engineBaseUrl, canaryTypes, since);
			this.lastPolledAt.set(actionInstance.id, now);

			const tick = (this.tickCounter.get(actionInstance.id) ?? 0) + 1;
			this.tickCounter.set(actionInstance.id, tick);

			const series = this.history.get(actionInstance.id) ?? [];
			series.push({ status, tick });
			while (series.length > MAX_HISTORY) {
				series.shift();
			}
			this.history.set(actionInstance.id, series);

			streamDeck.logger.info(
				`CanaryGraph[${actionInstance.id}] tick=${tick} seriesLen=${series.length} pending=${status.pendingCount} resolved=${status.resolvedCount} atRisk=${status.atRiskCount} triggered=${status.triggeredCount}`
			);

			await this.paint(actionInstance, series);
		} catch (err) {
			streamDeck.logger.error(`CanaryGraph refresh failed for ${canaryTypes.join(",")}`, err);
		}
	}

	private async paint(actionInstance: KeyAction<CanaryGraphSettings>, series: HistoryPoint[]): Promise<void> {
		const bars: string[] = [];

		const maxCount = Math.max(
			1,
			...series.map((e) => Math.max(e.status.pendingCount, e.status.resolvedCount, e.status.atRiskCount, e.status.triggeredCount))
		);

		let cursorX = IMAGE_SIZE;
		for (let i = series.length - 1; i >= 0; i--) {
			const { status: point } = series[i];
			const allValues: [number, string][] = [
				[point.pendingCount, COLORS.pending],
				[point.atRiskCount, COLORS.atRisk],
				[point.triggeredCount, COLORS.triggered],
				[point.resolvedCount, COLORS.resolved],
			];
			const values = allValues.filter(([count]) => count > 0);

			const groupWidth = values.length > 0 ? values.length * SUB_BAR_WIDTH + (values.length - 1) * SUB_BAR_GAP : SUB_BAR_WIDTH;
			const groupX = cursorX - groupWidth;

			if (groupX < 0) {
				break;
			}

			bars.push(`<rect x="${groupX}" y="${IMAGE_SIZE - 1}" width="${groupWidth}" height="1" fill="${COLORS.baseline}" />`);

			values.forEach(([count, color], slot) => {
				const barX = groupX + slot * (SUB_BAR_WIDTH + SUB_BAR_GAP);
				const barHeight = Math.max(2, (count / maxCount) * CHART_HEIGHT);
				const barY = IMAGE_SIZE - barHeight;
				bars.push(`<rect x="${barX}" y="${barY}" width="${SUB_BAR_WIDTH}" height="${barHeight}" fill="${color}" />`);
			});

			cursorX = groupX - GROUP_GAP;
		}

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SIZE}" height="${IMAGE_SIZE}">
			<rect width="${IMAGE_SIZE}" height="${IMAGE_SIZE}" fill="#2d2d2d" />
			<line x1="0" y1="${CHART_TOP}" x2="${IMAGE_SIZE}" y2="${CHART_TOP}" stroke="#555" stroke-width="1" />
			${bars.join("\n")}
		</svg>`;
		const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
		await actionInstance.setImage(image);
	}
}
