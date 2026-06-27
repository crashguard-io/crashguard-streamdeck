export interface CanaryTypeStatus {
	canaryType: string;
	pendingCount: number;
	atRiskCount: number;
	triggeredSinceCount: number;
}

export interface CanaryTypeSummary {
	id: number;
	name: string;
	timeout: number;
}

export async function getCanaryTypeStatus(baseUrl: string, canaryType: string, since: string): Promise<CanaryTypeStatus> {
	const url = `${baseUrl.replace(/\/$/, "")}/api/canary-types/${encodeURIComponent(canaryType)}/status?since=${encodeURIComponent(since)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch canary type status (${response.status})`);
	}
	return response.json();
}

export interface CanaryTypeAggregateStatus {
	pendingCount: number;
	resolvedCount: number;
	atRiskCount: number;
	triggeredCount: number;
}

export async function getCanaryTypesAggregateStatus(baseUrl: string, canaryTypes: string[], since: string): Promise<CanaryTypeAggregateStatus> {
	const params = new URLSearchParams({ names: canaryTypes.join(","), since });
	const url = `${baseUrl.replace(/\/$/, "")}/api/canary-types/status?${params}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch canary types aggregate status (${response.status})`);
	}
	return response.json();
}

export async function listCanaryTypes(baseUrl: string): Promise<CanaryTypeSummary[]> {
	const url = `${baseUrl.replace(/\/$/, "")}/api/canary-types`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to list canary types (${response.status})`);
	}
	return response.json();
}

export interface CanaryTypeHistoryBucket {
	bucketStart: string;
	triggeredCount: number;
	resolvedCount: number;
	pendingCount: number;
	avgResolutionSeconds: number | null;
}

export interface CanaryTypeHistory {
	canaryType: string;
	buckets: CanaryTypeHistoryBucket[];
}

export async function getCanaryTypeHistory(
	baseUrl: string,
	canaryType: string,
	since: string,
	bucketSeconds: number
): Promise<CanaryTypeHistory> {
	const params = new URLSearchParams({ since, bucketSeconds: String(bucketSeconds) });
	const url = `${baseUrl.replace(/\/$/, "")}/api/canary-types/${encodeURIComponent(canaryType)}/history?${params}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch canary type history (${response.status})`);
	}
	return response.json();
}
