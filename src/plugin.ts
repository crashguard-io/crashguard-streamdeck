import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { CanaryStatus } from "./actions/canary-status";
import { CanaryGraph } from "./actions/canary-graph";
import { CanaryMetrics } from "./actions/canary-metrics";
import { CanaryDial } from "./actions/canary-dial";
import { TriggerControl } from "./actions/trigger-control";
import { startConfigServer } from "./config-server";

streamDeck.logger.setLevel(LogLevel.TRACE);

streamDeck.actions.registerAction(new CanaryStatus());
streamDeck.actions.registerAction(new CanaryGraph());
streamDeck.actions.registerAction(new CanaryMetrics());
streamDeck.actions.registerAction(new CanaryDial());
streamDeck.actions.registerAction(new TriggerControl());

startConfigServer();

streamDeck.connect();
