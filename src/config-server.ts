import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import streamDeck from "@elgato/streamdeck";

import { getGlobalConfig, type GlobalConfig } from "./global-config";

export const CONFIG_SERVER_PORT = 39871;

const CONFIG_HTML_PATH = join(__dirname, "../ui/config.html");

export function startConfigServer(): void {
	const server = createServer(async (req, res) => {
		try {
			if (req.method === "GET" && req.url === "/") {
				const html = await readFile(CONFIG_HTML_PATH, "utf-8");
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(html);
				return;
			}

			if (req.method === "GET" && req.url === "/api/global-settings") {
				const config = await getGlobalConfig();
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(config));
				return;
			}

			if (req.method === "POST" && req.url === "/api/global-settings") {
				const body = await readBody(req);
				const update = JSON.parse(body) as Partial<GlobalConfig>;
				await streamDeck.settings.setGlobalSettings({
					engineBaseUrl: update.engineBaseUrl ?? "",
					appBaseUrl: update.appBaseUrl ?? "",
				});
				res.writeHead(204);
				res.end();
				return;
			}

			res.writeHead(404);
			res.end();
		} catch (err) {
			streamDeck.logger.error("Config server request failed", err);
			res.writeHead(500);
			res.end();
		}
	});

	server.listen(CONFIG_SERVER_PORT, "127.0.0.1");
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		let data = "";
		req.on("data", (chunk: Buffer) => (data += chunk));
		req.on("end", () => resolvePromise(data));
		req.on("error", rejectPromise);
	});
}
