"use strict";

const assert = require("node:assert/strict");
const { Control, DEFAULTS } = require("./control.js");

/**
 * Baut eine Steuerung mit gefaelschter Box dahinter.
 *
 * @param {Record<string, any>} box  Zustand, den die Box gerade meldet
 * @param {Partial<{minPowerW: number, rampFactor: number, rampIntervalMs: number}>} [cfg]
 */
function bauen(box, cfg = {}) {
	const gesendet = [];
	const control = new Control({
		publish: async (topic, value) => {
			gesendet.push([topic, value]);
		},
		readState: () => box,
		log: { info: () => {}, warn: () => {}, debug: () => {} },
		config: { rampIntervalMs: 10000, ...cfg },
	});
	return { control, gesendet, box };
}

const laedt = () => ({ sessionState: "CHARGE_LOOP", chargePowerMax: 10200 });

describe("Control - Ladegrenze", () => {
	it("hebt Werte unter dem Minimum an, statt die Sitzung zu toeten", async () => {
		const { control, gesendet } = bauen(laedt());
		const { accepted, note } = await control.requestLimit(300);
		assert.equal(accepted, DEFAULTS.minPowerW);
		assert.match(String(note), /Minimum/);
		assert.deepEqual(gesendet.at(-1), ["limitChargePower", String(DEFAULTS.minPowerW)]);
		control.destroy();
	});

	it("weist die Null ab - sie ist bei dieser Box keine Pause", async () => {
		const { control, gesendet } = bauen(laedt());
		const { accepted, note } = await control.requestLimit(0);
		assert.equal(accepted, 0);
		assert.match(String(note), /keine Pause/);
		assert.equal(gesendet.length, 0, "es darf nichts gesendet werden");
		control.destroy();
	});

	it("deckelt auf die vom Geraet gemeldete Obergrenze", async () => {
		const { control } = bauen(laedt());
		const { accepted } = await control.requestLimit(20000);
		assert.equal(accepted, 10200);
		control.destroy();
	});

	it("faellt hoechstens einen Rampenschritt je Intervall", async () => {
		const { control, gesendet } = bauen(laedt());
		await control.requestLimit(10000);
		gesendet.length = 0;

		// Grosser Wunsch nach unten: es darf nur ein Schritt herauskommen.
		await control.requestLimit(1000);
		const ersterSchritt = Math.round(10000 * DEFAULTS.rampFactor);
		assert.equal(gesendet.length, 1);
		assert.deepEqual(gesendet[0], ["limitChargePower", String(ersterSchritt)]);

		// Sofort noch einmal: das Intervall ist nicht um, also nichts.
		await control.step();
		assert.equal(gesendet.length, 1, "zu frueh - kein zweiter Schritt");

		// Intervall kuenstlich verstreichen lassen.
		control.steppedAt = Date.now() - 11000;
		await control.step();
		const zweiterSchritt = Math.round(ersterSchritt * DEFAULTS.rampFactor);
		assert.deepEqual(gesendet.at(-1), ["limitChargePower", String(zweiterSchritt)]);
		control.destroy();
	});

	it("geht nach oben ohne Begrenzung - das vertraegt die Box", async () => {
		const { control, gesendet } = bauen(laedt());
		await control.requestLimit(1000);
		gesendet.length = 0;
		await control.requestLimit(9000);
		assert.deepEqual(gesendet.at(-1), ["limitChargePower", "9000"]);
		control.destroy();
	});
});

describe("Control - Wecken", () => {
	it("verwirft wakeUp waehrend der Sperre", async () => {
		const { control, gesendet } = bauen({ sessionState: "STOPPED", wakeUpBlocked: true });
		const { sent, note } = await control.wakeUp();
		assert.equal(sent, false);
		assert.match(String(note), /gesperrt/);
		assert.equal(gesendet.length, 0);
		control.destroy();
	});

	it("verwirft wakeUp, wenn die Box Neustecken verlangt", async () => {
		const { control } = bauen({ sessionState: "ERROR", replugRequired: true });
		const { sent, note } = await control.wakeUp();
		assert.equal(sent, false);
		assert.match(String(note), /Neustecken/);
		control.destroy();
	});

	it("setzt die Ladegrenze vor dem Wecken - sonst faehrt die Box auf ihr Maximum", async () => {
		const { control, gesendet } = bauen({ sessionState: "STOPPED", wakeUpBlocked: false });
		const { sent } = await control.wakeUp();
		assert.equal(sent, true);
		assert.deepEqual(gesendet[0], ["limitChargePower", String(DEFAULTS.minPowerW)]);
		assert.deepEqual(gesendet[1], ["wakeUp", "true"]);
		control.destroy();
	});
});

describe("Control - Stoppen", () => {
	it("stoppt sauber, wenn wirklich geladen wird", async () => {
		const { control, gesendet } = bauen(laedt());
		const { sent } = await control.stopCharge();
		assert.equal(sent, true);
		assert.deepEqual(gesendet.at(-1), ["stopCharge", "true"]);
		control.destroy();
	});

	it("stellt den Stopp zurueck, solange die Box startet", async () => {
		const box = { sessionState: "STOPPED", wakeUpBlocked: false };
		const { control, gesendet } = bauen(box);
		await control.wakeUp();
		gesendet.length = 0;

		const { sent, note } = await control.stopCharge();
		assert.equal(sent, false);
		assert.match(String(note), /zurueckgestellt/);
		assert.equal(gesendet.length, 0, "ein Stopp im Startfenster erzwingt Neustecken");

		// Sobald die Ladung steht, wird der Stopp nachgeholt.
		box.sessionState = "CHARGE_LOOP";
		await control.tick();
		assert.deepEqual(gesendet.at(-1), ["stopCharge", "true"]);
		control.destroy();
	});

	it("verwirft einen Stopp ohne Sitzung dahinter", async () => {
		const { control, gesendet } = bauen({ sessionState: "STOPPED" });
		const { sent, note } = await control.stopCharge();
		assert.equal(sent, false);
		assert.match(String(note), /keine Ladung/);
		assert.equal(gesendet.length, 0);
		control.destroy();
	});
});
