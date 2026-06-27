import streamDeck, { action, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, DialRotateEvent, DialDownEvent, TouchTapEvent, DialAction, JsonValue } from "@elgato/streamdeck";

import { getCanaryTypeHistory, listCanaryTypes, type CanaryTypeHistoryBucket } from "../crashguard-api";
import { getGlobalConfig } from "../global-config";

interface CanaryDialSettings {
	[key: string]: JsonValue;
	canaryType?: string;
	intervalSeconds?: number;
}

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_INTERVAL_SECONDS = 3600;
const DEFAULT_TIMEOUT_SECONDS = 3600;

const CHART_WIDTH = 200;
const CHART_HEIGHT = 80;
const BAR_WIDTH = 6;
const BAR_GAP = 2;

// Vertical separator lines sit 1px in from each edge, so adjacent buttons on the panel
// always show a visible gap rather than their borders touching.
const EDGE_MARGIN = 1;
const LEFT_LINE_X = EDGE_MARGIN;
const RIGHT_LINE_X = CHART_WIDTH - 1 - EDGE_MARGIN;
const CONTENT_LEFT = LEFT_LINE_X + 2;
const CONTENT_RIGHT = RIGHT_LINE_X - 2;

const MAX_HISTORY = Math.ceil((CONTENT_RIGHT - CONTENT_LEFT) / (BAR_WIDTH + BAR_GAP));

type BarPageKey = "triggered" | "resolved" | "pending";
type PageKey = BarPageKey | "resolutionTime";

const PAGES: { key: PageKey; label: string; titleLines: string[] }[] = [
	{ key: "triggered", label: "Triggered", titleLines: ["TRIGGERED", "CANARIES"] },
	{ key: "resolved", label: "Resolved", titleLines: ["RESOLVED", "CANARIES"] },
	{ key: "pending", label: "Pending", titleLines: ["PENDING", "CANARIES"] },
	{ key: "resolutionTime", label: "Avg Resolution", titleLines: ["AVERAGE", "RESOLUTION", "TIME"] },
];

const STATUS_FILTER: Record<BarPageKey, string> = {
	triggered: "Triggered",
	resolved: "Resolved",
	pending: "Pending",
};

const TITLE_CARD_DISPLAY_MS = 900;

const SHADES: Record<BarPageKey, string[]> = {
	triggered: ["#ffcdd2", "#ef9a9a", "#e57373", "#ef5350", "#f44336", "#e53935", "#d32f2f", "#c62828", "#b71c1c"],
	resolved: ["#c8e6c9", "#a5d6a7", "#81c784", "#66bb6a", "#4caf50", "#43a047", "#388e3c", "#2e7d32", "#1b5e20"],
	pending: ["#bbdefb", "#90caf9", "#64b5f6", "#42a5f5", "#2196f3", "#1e88e5", "#1976d2", "#1565c0", "#0d47a1"],
};

@action({ UUID: "io.crashguard.streamdeck.canary-dial" })
export class CanaryDial extends SingletonAction<CanaryDialSettings> {
	private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly settingsCache = new Map<string, CanaryDialSettings>();
	private readonly pageIndex = new Map<string, number>();
	private readonly history = new Map<string, CanaryTypeHistoryBucket[]>();
	private readonly timeoutSeconds = new Map<string, number>();
	private readonly timeoutLoadedFor = new Map<string, string>();
	private readonly titleCardTimers = new Map<string, ReturnType<typeof setTimeout>>();

	override onWillAppear(ev: WillAppearEvent<CanaryDialSettings>): void | Promise<void> {
		this.settingsCache.set(ev.action.id, ev.payload.settings);
		this.pageIndex.set(ev.action.id, 0);
		this.startPolling(ev.action as DialAction<CanaryDialSettings>);
		return this.refresh(ev.action as DialAction<CanaryDialSettings>, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<CanaryDialSettings>): void {
		this.stopPolling(ev.action.id);
		this.settingsCache.delete(ev.action.id);
		this.pageIndex.delete(ev.action.id);
		this.history.delete(ev.action.id);
		this.timeoutSeconds.delete(ev.action.id);
		this.timeoutLoadedFor.delete(ev.action.id);
		this.clearTitleCardTimer(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<CanaryDialSettings>): void | Promise<void> {
		const previous = this.settingsCache.get(ev.action.id);
		const changedType = previous?.canaryType !== ev.payload.settings.canaryType;
		this.settingsCache.set(ev.action.id, ev.payload.settings);

		if (changedType) {
			this.history.delete(ev.action.id);
		}

		return this.refresh(ev.action as DialAction<CanaryDialSettings>, ev.payload.settings);
	}

	override onDialRotate(ev: DialRotateEvent<CanaryDialSettings>): void {
		const current = this.pageIndex.get(ev.action.id) ?? 0;
		const direction = ev.payload.ticks > 0 ? 1 : -1;
		const next = (current + direction + PAGES.length) % PAGES.length;
		this.pageIndex.set(ev.action.id, next);

		this.showTitleCard(ev.action as DialAction<CanaryDialSettings>, PAGES[next]);
	}

	private showTitleCard(actionInstance: DialAction<CanaryDialSettings>, page: { titleLines: string[] }): void {
		this.clearTitleCardTimer(actionInstance.id);
		void actionInstance.setFeedback({ chart: this.renderTitleCard(page.titleLines) });

		const timer = setTimeout(() => {
			this.titleCardTimers.delete(actionInstance.id);
			const settings = this.settingsCache.get(actionInstance.id) ?? {};
			this.paint(actionInstance, settings);
		}, TITLE_CARD_DISPLAY_MS);
		this.titleCardTimers.set(actionInstance.id, timer);
	}

	private clearTitleCardTimer(actionId: string): void {
		const timer = this.titleCardTimers.get(actionId);
		if (timer) {
			clearTimeout(timer);
			this.titleCardTimers.delete(actionId);
		}
	}

	override onDialDown(ev: DialDownEvent<CanaryDialSettings>): void | Promise<void> {
		const settings = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
		return this.refresh(ev.action as DialAction<CanaryDialSettings>, settings);
	}

	override async onTouchTap(ev: TouchTapEvent<CanaryDialSettings>): Promise<void> {
		const settings = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
		const pageIdx = this.pageIndex.get(ev.action.id) ?? 0;
		const page = PAGES[pageIdx];

		if (page.key === "resolutionTime" || !settings.canaryType) return;

		const { appBaseUrl } = await getGlobalConfig();
		const params = new URLSearchParams({
			canaryType: settings.canaryType,
			status: STATUS_FILTER[page.key],
		});
		await streamDeck.system.openUrl(`${appBaseUrl.replace(/\/$/, "")}/canaries?${params.toString()}`);
	}

	private startPolling(actionInstance: DialAction<CanaryDialSettings>): void {
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

	private async refresh(actionInstance: DialAction<CanaryDialSettings>, settings: CanaryDialSettings): Promise<void> {
		const canaryType = settings.canaryType;
		if (!canaryType) {
			this.history.set(actionInstance.id, []);
			this.paint(actionInstance, settings);
			return;
		}

		const { engineBaseUrl } = await getGlobalConfig();
		const intervalSeconds = Math.max(1, settings.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS);
		const since = new Date(Date.now() - intervalSeconds * 1000).toISOString();

		if (this.timeoutLoadedFor.get(actionInstance.id) !== canaryType) {
			try {
				const types = await listCanaryTypes(engineBaseUrl);
				const match = types.find((t) => t.name === canaryType);
				this.timeoutSeconds.set(actionInstance.id, match?.timeout ?? DEFAULT_TIMEOUT_SECONDS);
				this.timeoutLoadedFor.set(actionInstance.id, canaryType);
			} catch (err) {
				streamDeck.logger.error(`CanaryDial failed to load timeout for ${canaryType}`, err);
			}
		}

		try {
			// Asking for a single bucket spanning the whole trailing window can still come back
			// as 2+ sub-buckets (server "now" lands a few ms after our locally computed "since"),
			// so aggregate everything returned instead of trusting bucket count === 1.
			const result = await getCanaryTypeHistory(engineBaseUrl, canaryType, since, intervalSeconds);
			const latest = this.aggregateBuckets(result.buckets, since);
			if (latest) {
				const series = this.history.get(actionInstance.id) ?? [];
				series.push(latest);
				while (series.length > MAX_HISTORY) {
					series.shift();
				}
				this.history.set(actionInstance.id, series);
			}
		} catch (err) {
			streamDeck.logger.error(`CanaryDial refresh failed for ${canaryType}`, err);
		}

		this.paint(actionInstance, settings);
	}

	private aggregateBuckets(buckets: CanaryTypeHistoryBucket[], fallbackBucketStart: string): CanaryTypeHistoryBucket | undefined {
		if (buckets.length === 0) return undefined;

		const triggeredCount = buckets.reduce((sum, b) => sum + b.triggeredCount, 0);
		const resolvedCount = buckets.reduce((sum, b) => sum + b.resolvedCount, 0);
		const weightedResolution = buckets.reduce((sum, b) => sum + (b.avgResolutionSeconds ?? 0) * b.resolvedCount, 0);

		return {
			bucketStart: buckets[buckets.length - 1]?.bucketStart ?? fallbackBucketStart,
			triggeredCount,
			resolvedCount,
			// Pending is a point-in-time snapshot, not additive across buckets - use the most recent one.
			pendingCount: buckets[buckets.length - 1].pendingCount,
			avgResolutionSeconds: resolvedCount > 0 ? weightedResolution / resolvedCount : null,
		};
	}

	private paint(actionInstance: DialAction<CanaryDialSettings>, settings: CanaryDialSettings): void {
		if (this.titleCardTimers.has(actionInstance.id)) return;

		const pageIdx = this.pageIndex.get(actionInstance.id) ?? 0;
		const page = PAGES[pageIdx];
		const timeoutSeconds = this.timeoutSeconds.get(actionInstance.id) ?? DEFAULT_TIMEOUT_SECONDS;

		void actionInstance.setTitle(settings.canaryType ?? "Select a canary type");
		void actionInstance.setFeedback({
			chart:
				page.key === "resolutionTime"
					? this.renderLineChart(this.history.get(actionInstance.id) ?? [], timeoutSeconds)
					: this.renderBarChart(page.key, this.history.get(actionInstance.id) ?? []),
		});
	}

	private renderBarChart(key: BarPageKey, buckets: CanaryTypeHistoryBucket[]): string {
		const countKey = `${key}Count` as "triggeredCount" | "resolvedCount" | "pendingCount";
		const values = buckets.map((b) => b[countKey]);
		const maxValue = Math.max(1, ...values);

		const bars: string[] = [];
		let cursorX = CONTENT_RIGHT - BAR_GAP;
		for (let i = values.length - 1; i >= 0; i--) {
			const value = values[i];
			const x = cursorX - BAR_WIDTH;
			if (x < CONTENT_LEFT) break;

			const barHeight = value > 0 ? Math.max(2, (value / maxValue) * (CHART_HEIGHT - 4)) : 0;
			const y = CHART_HEIGHT - barHeight;
			if (barHeight > 0) {
				bars.push(`<rect x="${x}" y="${y}" width="${BAR_WIDTH}" height="${barHeight}" fill="${this.shadeFor(key, value, maxValue)}" />`);
			}

			cursorX = x - BAR_GAP;
		}

		const latestValue = buckets.length > 0 ? buckets[buckets.length - 1][countKey] : undefined;
		return this.wrapSvg(bars.join("\n"), latestValue !== undefined ? `${latestValue}` : undefined);
	}

	private renderLineChart(buckets: CanaryTypeHistoryBucket[], maxSeconds: number): string {
		const usable = Math.max(1, maxSeconds);

		const points: { x: number; y: number }[] = [];
		let cursorX = CONTENT_RIGHT - BAR_GAP - BAR_WIDTH / 2;
		for (let i = buckets.length - 1; i >= 0; i--) {
			if (cursorX < CONTENT_LEFT) break;

			const value = buckets[i].avgResolutionSeconds;
			if (value !== null && value !== undefined) {
				const clamped = Math.min(usable, Math.max(0, value));
				const y = CHART_HEIGHT - 2 - (clamped / usable) * (CHART_HEIGHT - 4);
				points.unshift({ x: cursorX, y });
			}

			cursorX -= BAR_WIDTH + BAR_GAP;
		}

		// Most recently rendered bucket with a real value, regardless of how far back it is.
		const latestBucket = [...buckets].reverse().find((b) => b.avgResolutionSeconds !== null && b.avgResolutionSeconds !== undefined);
		const latestLabel = latestBucket ? `${Math.round(latestBucket.avgResolutionSeconds as number)}s` : undefined;

		if (points.length === 0) {
			return this.wrapSvg("", latestLabel);
		}

		// Sparkline style: a single smooth, thicker stroke with no per-point markers.
		const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

		// Dashed top boundary marks the configured timeout - the ceiling of the 0..timeout range this line is scaled against.
		const maxLine = `<line x1="${CONTENT_LEFT}" y1="2" x2="${CONTENT_RIGHT}" y2="2" stroke="#444" stroke-width="1" stroke-dasharray="3,3" />`;

		return this.wrapSvg(
			`${maxLine}\n<path d="${path}" fill="none" stroke="#4caf50" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`,
			latestLabel,
		);
	}

	private renderTitleCard(lines: string[]): string {
		const fontSize = lines.length >= 3 ? 17 : 20;
		const lineHeight = fontSize + 6;
		const startY = CHART_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize / 3;

		const text = lines
			.map(
				(line, i) =>
					`<text x="${CHART_WIDTH / 2}" y="${startY + i * lineHeight}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" fill="#ffffff">${line}</text>`,
			)
			.join("\n");

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}">
			<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#000000">
				<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.7;1" dur="${TITLE_CARD_DISPLAY_MS}ms" fill="freeze" />
			</rect>
			<g>
				<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.7;1" dur="${TITLE_CARD_DISPLAY_MS}ms" fill="freeze" />
				${text}
			</g>
		</svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	}

	private wrapSvg(content: string, centerLabel?: string): string {
		const label = centerLabel
			? `<text x="${CHART_WIDTH / 2}" y="${CHART_HEIGHT / 2 + 10}" text-anchor="middle" font-size="28" font-weight="bold" fill="#ffffff">${centerLabel}</text>`
			: "";

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}">
			<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#000000" />
			<line x1="0" y1="${CHART_HEIGHT - 1}" x2="${CHART_WIDTH}" y2="${CHART_HEIGHT - 1}" stroke="#555" stroke-width="1" />
			<line x1="${LEFT_LINE_X}" y1="0" x2="${LEFT_LINE_X}" y2="${CHART_HEIGHT}" stroke="#666" stroke-width="1" />
			<line x1="${RIGHT_LINE_X}" y1="0" x2="${RIGHT_LINE_X}" y2="${CHART_HEIGHT}" stroke="#666" stroke-width="1" />
			${content}
			${label}
		</svg>`;
		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
	}

	private shadeFor(key: BarPageKey, value: number, maxValue: number): string {
		const shades = SHADES[key];
		if (value <= 0) return shades[0];
		const ratio = Math.min(1, value / maxValue);
		const baseIdx = Math.floor(ratio * (shades.length - 1));
		// Independent per-bar jitter so each bar/dot gets its own distinct shade, not a single flat color.
		const jitter = Math.floor(Math.random() * 3) - 1;
		const idx = Math.min(shades.length - 1, Math.max(0, baseIdx + jitter));
		return shades[idx];
	}
}
