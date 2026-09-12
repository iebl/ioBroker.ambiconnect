"use strict";

/**
 * Sicherheitsschicht fuer die Steuerbefehle der Ambibox.
 *
 * Der Grund, warum dieser Adapter kein duenner MQTT-Durchreicher sein darf:
 * bei dieser Box ist ein beschreibbarer Zahlenwert kein Bedienelement, sondern
 * eine Falle. Alle Regeln hier sind an der echten Box gemessen, nicht geraten.
 *
 *   - Eine Ladegrenze unter dem Minimum beendet die Sitzung. Die Box wehrt sich
 *     nicht dagegen: sie uebernimmt den Wert wortwoertlich und laesst ihre
 *     Leistungsendstufe darueber stolpern.
 *   - Eine Null ist keine Pause. Ohne stopCharge haelt die Sitzung rund 66 s
 *     und stirbt dann endgueltig.
 *   - Ein zu grosser Schritt nach unten toetet eine Sitzung, die denselben Wert
 *     schrittweise erreicht problemlos uebersteht.
 *   - stopCharge waehrend des Startvorgangs wirft die Box in ERROR und verlangt
 *     koerperliches Neustecken. Kein Befehl holt sie da heraus.
 *   - Nach einem Abbruch ist wakeUp rund fuenf Minuten gesperrt.
 */

/** Vorgaben; per Adapterkonfiguration ueberschreibbar. */
const DEFAULTS = {
	// Gemessen am 12.09.2026 mit abgeschaltetem ChargeControl der Box:
	// 510 W laufen stabil, 459 W loesen die Leistungsendstufe aus. 600 W haelt
	// Abstand und ist zugleich der Wert, den die Box selbst als ihr Minimum
	// meldet (ESS-Eingangsregister 6002) - ohne ihn durchzusetzen.
	minPowerW: 600,
	// Fuenf Abstiege von 10200 auf 700 W haben alle gehalten, bis
	// einschliesslich -40 % alle 5 s. Hier steht die Haelfte davon.
	rampFactor: 0.8,
	rampIntervalMs: 5000,
	startupWindowMs: 45000,
	stopDeferralMs: 120000,
};

class Control {
	/**
	 * @param {object} opts
	 * @param {(topic: string, value: string) => Promise<void>} opts.publish
	 * @param {() => Record<string, any>} opts.readState  liefert die zuletzt empfangenen Box-Werte
	 * @param {{ info: Function, warn: Function, debug: Function }} opts.log
	 * @param {Partial<typeof DEFAULTS>} [opts.config]
	 */
	constructor({ publish, readState, log, config = {} }) {
		this.publish = publish;
		this.readState = readState;
		this.log = log;
		this.cfg = { ...DEFAULTS, ...config };

		/** zuletzt tatsaechlich gesendete Grenze */
		this.currentLimit = null;
		/** Wunschwert, auf den wir zulaufen */
		this.targetLimit = null;
		/** Zeitpunkt des letzten Abwaertsschritts */
		this.steppedAt = 0;
		/** Zeitpunkt unseres wakeUp - die Box verraet ihr Startfenster nicht */
		this.wokeAt = 0;
		/** zurueckgestellter Stopp */
		this.pendingStop = 0;

		this.timer = null;
	}

	/** Laeuft gerade eine Ladung? */
	isCharging() {
		return this.readState().sessionState === "CHARGE_LOOP";
	}

	/**
	 * Startet die Box gerade? Die Box zeigt das nicht an - sessionState bleibt
	 * waehrend des ganzen Startvorgangs auf STOPPED -, also zaehlen wir selbst
	 * ab unserem wakeUp.
	 */
	isStartingUp() {
		return this.wokeAt > 0 && Date.now() - this.wokeAt < this.cfg.startupWindowMs && !this.isCharging();
	}

	/**
	 * Nimmt einen Grenzwunsch entgegen. Grosse Absenkungen werden nicht sofort
	 * gesendet, sondern in Schritten abgearbeitet.
	 *
	 * @param {number} watt gewuenschte Ladegrenze
	 * @returns {Promise<{accepted: number, note?: string}>}
	 */
	async requestLimit(watt) {
		const max = Number(this.readState().chargePowerMax) || 10200;

		if (watt <= 0) {
			return { accepted: 0, note: "Null ist bei dieser Box keine Pause - nutze stopCharge" };
		}

		let ziel = Math.round(watt);
		let note;
		if (ziel < this.cfg.minPowerW) {
			note = `auf das Minimum ${this.cfg.minPowerW} W angehoben (angefragt ${ziel} W)`;
			ziel = this.cfg.minPowerW;
		}
		if (ziel > max) {
			note = `auf die Gerätegrenze ${max} W gedeckelt (angefragt ${ziel} W)`;
			ziel = max;
		}

		this.targetLimit = ziel;
		await this.step();
		this.ensureTimer();
		return { accepted: ziel, note };
	}

	/**
	 * Ein Schritt Richtung Ziel. Aufwaerts ohne Begrenzung - das vertraegt die
	 * Box -, abwaerts hoechstens ein Rampenschritt je Intervall.
	 */
	async step() {
		if (this.targetLimit === null) {
			return;
		}
		if (this.currentLimit === null) {
			await this.send(this.targetLimit);
			return;
		}
		if (this.targetLimit >= this.currentLimit) {
			await this.send(this.targetLimit);
			return;
		}
		if (Date.now() - this.steppedAt < this.cfg.rampIntervalMs) {
			return;
		}
		const naechster = Math.max(this.targetLimit, Math.round(this.currentLimit * this.cfg.rampFactor));
		await this.send(naechster);
		this.steppedAt = Date.now();
	}

	/** @param {number} watt */
	async send(watt) {
		if (watt === this.currentLimit) {
			return;
		}
		await this.publish("limitChargePower", String(watt));
		this.currentLimit = watt;
		this.log.debug(`Ladegrenze gesetzt: ${watt} W`);
	}

	ensureTimer() {
		if (this.timer) {
			return;
		}
		this.timer = setInterval(() => {
			void this.tick();
		}, 1000);
	}

	async tick() {
		if (this.isCharging() && this.targetLimit !== null && this.currentLimit !== this.targetLimit) {
			await this.step();
		}
		if (this.pendingStop && Date.now() < this.pendingStop && this.isCharging()) {
			this.pendingStop = 0;
			this.log.info("zurueckgestellter Stopp wird jetzt ausgefuehrt - die Box ist im Ladebetrieb angekommen");
			await this.publish("stopCharge", "true");
		} else if (this.pendingStop && Date.now() >= this.pendingStop) {
			this.pendingStop = 0;
			this.log.warn("zurueckgestellter Stopp verfallen - es kam keine Ladung zustande");
		}
	}

	/**
	 * Weckt die Box. Die Ladegrenze muss vorher stehen, sonst faehrt die Box auf
	 * ihr eigenes Maximum hoch.
	 *
	 * @returns {Promise<{sent: boolean, note?: string}>}
	 */
	async wakeUp() {
		const s = this.readState();
		if (s.wakeUpBlocked === true) {
			return { sent: false, note: "die Box hat wakeUp gesperrt (rund fuenf Minuten nach einem Abbruch)" };
		}
		if (s.replugRequired === true) {
			return { sent: false, note: "die Box verlangt koerperliches Neustecken - kein Befehl hilft" };
		}
		if (this.isCharging()) {
			return { sent: false, note: "es laedt bereits" };
		}
		if (this.currentLimit === null) {
			await this.send(this.cfg.minPowerW);
		}
		await this.publish("wakeUp", "true");
		this.wokeAt = Date.now();
		return { sent: true };
	}

	/**
	 * Beendet die Ladung - aber nur, wenn das gefahrlos ist.
	 *
	 * @returns {Promise<{sent: boolean, note?: string}>}
	 */
	async stopCharge() {
		if (this.isCharging()) {
			await this.publish("stopCharge", "true");
			this.currentLimit = null;
			this.targetLimit = null;
			return { sent: true };
		}
		if (this.isStartingUp()) {
			this.pendingStop = Date.now() + this.cfg.stopDeferralMs;
			return {
				sent: false,
				note: "die Box startet noch - ein Stopp jetzt wuerde Neustecken erzwingen, er wird zurueckgestellt",
			};
		}
		return { sent: false, note: "keine Ladung aktiv, Stopp verworfen" };
	}

	destroy() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}

module.exports = { Control, DEFAULTS };
