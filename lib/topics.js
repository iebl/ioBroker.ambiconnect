"use strict";

/**
 * Landkarte der MQTT-Topics der Ambibox ambiCHARGE Home.
 *
 * Die Box wirft alles flach nach `device/evCharger/0/<name>`. Hier bekommt jeder
 * Wert einen Kanal, einen Typ und eine Rolle, damit ioBroker etwas Sinnvolles
 * anzeigt und Skripte sich auf Einheiten verlassen koennen.
 *
 * Gemessen an Firmware 0.4.8 (Manny). Die Vorzeichenkonvention der Box ist
 * ungewoehnlich: Leistung ist beim *Laden* negativ.
 */

/**
 * channel   Kanal im Objektbaum
 *
 * [write]  beschreibbar (Steuerung)
 *
 * [noisy]  hohe Aenderungsrate, wird entprellt
 *
 * @property {string} [desc]
 */

const TOPICS = {
	// --- Gerät ---------------------------------------------------------------
	serialNumber: { channel: "info", type: "string", role: "info.serial" },
	version: { channel: "info", type: "string", role: "info.version" },
	connected: { channel: "info", type: "boolean", role: "indicator.connected" },
	chargeProtocol: {
		channel: "info",
		type: "string",
		role: "text",
		desc: "ISO_15118_2, ISO_15118_20 oder DIN_70121 - entscheidet, was an Steuerung ueberhaupt moeglich ist",
	},
	controlMode: {
		channel: "info",
		type: "string",
		role: "text",
		desc: "LIMITABLE = nur Grenzen, CONTROLLABLE = Sollwerte. Haengt am Lademodus des Fahrzeugs.",
	},

	// --- Ladesitzung ---------------------------------------------------------
	sessionState: {
		channel: "session",
		type: "string",
		role: "text",
		desc: "STOPPED, SESSION_SETUP, CABLE_CHECK, PRE_CHARGE, CHARGE_LOOP, POST_CHARGE, ERROR",
	},
	evConnected: { channel: "session", type: "boolean", role: "indicator.connected" },
	replugRequired: {
		channel: "session",
		type: "boolean",
		role: "indicator.alarm",
		desc: "Nur durch koerperliches Aus- und Einstecken zu loesen - kein Befehl hilft",
	},
	wakeUpBlocked: {
		channel: "session",
		type: "boolean",
		role: "indicator",
		desc: "Nach einem Abbruch rund fuenf Minuten gesetzt; wakeUp wird solange verworfen",
	},
	sleep: { channel: "session", type: "boolean", role: "indicator" },
	inverterError: {
		channel: "session",
		type: "string",
		role: "text",
		desc: "Grobe Angabe (OTHER_ALARM). Der genaue Code steht nur in Modbus 4044/4096.",
	},
	soc: { channel: "session", type: "number", role: "value.battery", unit: "%" },
	targetEnergyRequest: { channel: "session", type: "number", role: "value.energy", unit: "Wh" },
	energyAcImportSession: { channel: "session", type: "number", role: "value.energy", unit: "Wh" },
	energyAcExportSession: { channel: "session", type: "number", role: "value.energy", unit: "Wh" },

	// --- Messwerte -----------------------------------------------------------
	powerAc: { channel: "measurement", type: "number", role: "value.power", unit: "W", noisy: true },
	powerDc: {
		channel: "measurement",
		type: "number",
		role: "value.power",
		unit: "W",
		noisy: true,
		desc: "Die Steuergroesse: limitChargePower wirkt auf die DC-Seite, powerAc traegt zusaetzlich den Wandlungsverlust",
	},
	currentAc: { channel: "measurement", type: "number", role: "value.current", unit: "A", noisy: true },
	currentAc1: { channel: "measurement", type: "number", role: "value.current", unit: "A", noisy: true },
	currentAc2: { channel: "measurement", type: "number", role: "value.current", unit: "A", noisy: true },
	currentAc3: { channel: "measurement", type: "number", role: "value.current", unit: "A", noisy: true },
	currentDc: { channel: "measurement", type: "number", role: "value.current", unit: "A", noisy: true },
	voltageAc: { channel: "measurement", type: "number", role: "value.voltage", unit: "V", noisy: true },
	voltageAc1: { channel: "measurement", type: "number", role: "value.voltage", unit: "V", noisy: true },
	voltageAc2: { channel: "measurement", type: "number", role: "value.voltage", unit: "V", noisy: true },
	voltageAc3: { channel: "measurement", type: "number", role: "value.voltage", unit: "V", noisy: true },
	voltageDc: { channel: "measurement", type: "number", role: "value.voltage", unit: "V", noisy: true },
	frequency: { channel: "measurement", type: "number", role: "value.frequency", unit: "Hz", noisy: true },
	inverterTemperature: { channel: "measurement", type: "number", role: "value.temperature", unit: "°C" },
	energyAc: { channel: "measurement", type: "number", role: "value.energy", unit: "Wh" },
	energyAcImport: { channel: "measurement", type: "number", role: "value.energy", unit: "Wh" },
	energyAcExport: { channel: "measurement", type: "number", role: "value.energy", unit: "Wh" },

	// --- Grenzen, die die Box meldet -----------------------------------------
	chargePowerMax: { channel: "limit", type: "number", role: "value.power", unit: "W" },
	dischargePowerMax: { channel: "limit", type: "number", role: "value.power", unit: "W" },

	// --- Steuerung -----------------------------------------------------------
	// Alle nur beschreibbar, wenn in der Konfiguration ausdruecklich freigegeben.
	limitChargePower: {
		channel: "control",
		type: "number",
		role: "level.power",
		unit: "W",
		write: true,
		desc: "Ladegrenze DC. Wird intern auf das Minimum angehoben und in Rampen gefahren - ein Sprung nach unten toetet die Sitzung.",
	},
	limitDischargePower: {
		channel: "control",
		type: "number",
		role: "level.power",
		unit: "W",
		write: true,
	},
	targetPower: {
		channel: "control",
		type: "number",
		role: "level.power",
		unit: "W",
		write: true,
		desc: "Sollwert, negativ = laden. Nur wirksam bei controlMode CONTROLLABLE; verfaellt nach 60 s ohne Auffrischung.",
	},
	wakeUp: { channel: "control", type: "boolean", role: "button", write: true },
	stopCharge: { channel: "control", type: "boolean", role: "button", write: true },
	setSleep: {
		channel: "control",
		type: "boolean",
		role: "button",
		write: true,
		desc: "In Firmware 0.4.8 wirkungslos: der Broker nimmt das Topic an, kein Prozess der Box liest es (gemessen 12.09.2026).",
	},
};

/** Kanaele mit Beschriftung fuer den Objektbaum. */
const CHANNELS = {
	info: "Geraet",
	session: "Ladesitzung",
	measurement: "Messwerte",
	limit: "Gemeldete Grenzen",
	control: "Steuerung",
};

module.exports = { TOPICS, CHANNELS };
