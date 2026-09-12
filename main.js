"use strict";

/*
 * AMBIConnect - Ambibox ambiCHARGE Home in ioBroker
 * Erzeugt mit @iobroker/create-adapter v3.1.5
 */

const utils = require("@iobroker/adapter-core");
const mqtt = require("mqtt");
const { TOPICS, CHANNELS } = require("./lib/topics.js");
const { Control } = require("./lib/control.js");

class Ambiconnect extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	constructor(options) {
		super({ ...options, name: "ambiconnect" });

		this.client = null;
		this.control = null;
		/** zuletzt von der Box empfangene Rohwerte */
		this.box = {};
		/** Entprellung der Messwerte: Name -> {at, value} */
		this.lastWritten = {};

		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/** Basis-Topic ohne Schraegstrich am Ende. */
	get prefix() {
		return String(this.config.deviceTopic || "device/evCharger/0").replace(/\/+$/, "");
	}

	async onReady() {
		await this.setState("info.connection", false, true);
		await this.buildTree();

		this.control = new Control({
			publish: (topic, value) => this.publish(topic, value),
			readState: () => this.box,
			log: this.log,
			config: {
				minPowerW: Number(this.config.minPowerW) || 700,
				rampFactor: Number(this.config.rampFactor) || 0.9,
				rampIntervalMs: Number(this.config.rampIntervalMs) || 10000,
			},
		});

		this.subscribeStates("control.*");
		this.connect();
	}

	/** Kanaele und Zustaende aus der Topic-Landkarte anlegen. */
	async buildTree() {
		const steuerbar = this.config.controlEnabled === true;

		for (const [id, label] of Object.entries(CHANNELS)) {
			await this.setObjectNotExistsAsync(id, {
				type: "channel",
				common: { name: label },
				native: {},
			});
		}

		for (const [name, def] of Object.entries(TOPICS)) {
			const id = `${def.channel}.${name}`;
			const schreibbar = def.write === true && steuerbar;
			await this.setObjectAsync(id, {
				type: "state",
				common: {
					name: def.desc ? `${name} - ${def.desc}` : name,
					type: /** @type {ioBroker.CommonType} */ (def.type),
					role: def.role,
					read: true,
					write: schreibbar,
					...(def.unit ? { unit: def.unit } : {}),
				},
				native: { topic: name },
			});
		}

		if (!steuerbar) {
			this.log.info(
				"Steuerung ist gesperrt (controlEnabled aus). Diese Box vertraegt nur einen Regler - " +
					"freigeben, wenn AMBIConnect ihn stellen soll und nicht evcc oder das Box-eigene ChargeControl.",
			);
		}
	}

	connect() {
		const url = `mqtt://${this.config.host}:${this.config.port || 1883}`;
		this.log.info(`verbinde mit ${url}`);

		this.client = mqtt.connect(url, {
			username: this.config.username || undefined,
			password: this.config.password || undefined,
			clientId: `ambiconnect-${this.namespace}-${Date.now()}`,
			reconnectPeriod: 5000,
		});

		this.client.on("connect", () => {
			this.log.info("Broker verbunden");
			void this.setState("info.connection", true, true);
			this.client?.subscribe(`${this.prefix}/#`, err => {
				if (err) {
					this.log.error(`Abonnement fehlgeschlagen: ${err.message}`);
				}
			});
		});

		this.client.on("close", () => void this.setState("info.connection", false, true));
		this.client.on("error", err => this.log.error(`MQTT: ${err.message}`));
		this.client.on("message", (topic, payload) => this.onMessage(topic, payload.toString()));
	}

	/**
	 * @param {string} topic
	 * @param {string} raw
	 */
	onMessage(topic, raw) {
		const name = topic.slice(this.prefix.length + 1);
		const def = TOPICS[name];
		if (!def) {
			this.log.debug(`unbekanntes Topic ${name} = ${raw}`);
			return;
		}

		// Leere Nutzlast = die Box loescht einen retained Wert.
		const wert = raw === "" ? null : this.parse(raw, def.type);
		this.box[name] = wert;

		if (def.noisy && !this.shouldWrite(name, wert)) {
			return;
		}
		this.lastWritten[name] = { at: Date.now(), value: wert };
		void this.setState(`${def.channel}.${name}`, wert, true);
	}

	/**
	 * @param {string} raw
	 * @param {string} type
	 */
	parse(raw, type) {
		if (type === "number") {
			const n = Number(raw);
			return Number.isFinite(n) ? n : null;
		}
		if (type === "boolean") {
			return raw === "true" || raw === "1";
		}
		return raw;
	}

	/**
	 * Messwerte kommen teils mehrfach je Sekunde. Geschrieben wird nur, wenn sich
	 * etwas Nennenswertes getan hat oder das Mindestintervall vorbei ist.
	 *
	 * @param {string} name
	 * @param {any} wert
	 */
	shouldWrite(name, wert) {
		const letzte = this.lastWritten[name];
		if (!letzte) {
			return true;
		}
		const intervall = Number(this.config.measurementIntervalMs) || 5000;
		if (Date.now() - letzte.at >= intervall) {
			return true;
		}
		const totzone = Number(this.config.measurementDeadband) || 0;
		if (totzone > 0 && typeof wert === "number" && typeof letzte.value === "number") {
			return Math.abs(wert - letzte.value) >= totzone;
		}
		return false;
	}

	/**
	 * @param {string} topic Name ohne Praefix
	 * @param {string} value
	 */
	async publish(topic, value) {
		if (!this.client?.connected) {
			throw new Error("Broker nicht verbunden");
		}
		// Befehle bewusst ohne retain: ein liegengebliebenes wakeUp=true wuerde
		// die Box beim naechsten Verbindungsaufbau erneut wecken.
		const retain = topic.startsWith("limit") || topic === "targetPower";
		await new Promise((resolve, reject) => {
			this.client?.publish(`${this.prefix}/${topic}`, value, { retain }, err =>
				err ? reject(err) : resolve(undefined),
			);
		});
	}

	/**
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (!state || state.ack) {
			return;
		}
		if (this.config.controlEnabled !== true) {
			this.log.warn(`${id} wurde beschrieben, aber die Steuerung ist gesperrt`);
			return;
		}
		const name = id.split(".").pop();
		if (!name || !this.control) {
			return;
		}

		try {
			switch (name) {
				case "limitChargePower": {
					const { accepted, note } = await this.control.requestLimit(Number(state.val));
					if (note) {
						this.log.warn(`${name}: ${note}`);
					}
					await this.setState(id, accepted, true);
					break;
				}
				case "wakeUp": {
					const { sent, note } = await this.control.wakeUp();
					if (note) {
						this.log.warn(`wakeUp: ${note}`);
					}
					await this.setState(id, sent, true);
					break;
				}
				case "stopCharge": {
					const { sent, note } = await this.control.stopCharge();
					if (note) {
						this.log.warn(`stopCharge: ${note}`);
					}
					await this.setState(id, sent, true);
					break;
				}
				case "setSleep": {
					this.log.warn(
						"setSleep ist in Firmware 0.4.8 wirkungslos: der Broker nimmt das Topic an, " +
							"kein Prozess der Box liest es. Eine Pause ohne Ladeende gibt es nicht.",
					);
					await this.publish("setSleep", state.val ? "true" : "false");
					await this.setState(id, state.val, true);
					break;
				}
				case "targetPower": {
					this.log.warn(
						"targetPower wirkt nur bei controlMode CONTROLLABLE und verfaellt nach 60 s " +
							"ohne Auffrischung - ohne eigenen Herzschlag faellt die Box auf 0 W zurueck.",
					);
					await this.publish("targetPower", String(state.val));
					await this.setState(id, state.val, true);
					break;
				}
				default: {
					await this.publish(name, String(state.val));
					await this.setState(id, state.val, true);
				}
			}
		} catch (err) {
			this.log.error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.control?.destroy();
			this.client?.end(true);
			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	/** @param {Partial<utils.AdapterOptions>} [options] */
	module.exports = options => new Ambiconnect(options);
} else {
	new Ambiconnect();
}
