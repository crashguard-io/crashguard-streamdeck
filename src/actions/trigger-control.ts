import streamDeck, { action, SingletonAction, KeyDownEvent } from "@elgato/streamdeck";

@action({ UUID: "io.crashguard.streamdeck.trigger-control" })
export class TriggerControl extends SingletonAction {
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		streamDeck.logger.info("TriggerControl pressed", ev.action.id);
		// TODO: call CrashGuard API (e.g. restart service, acknowledge alert)
	}
}
