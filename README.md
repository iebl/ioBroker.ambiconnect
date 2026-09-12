![Logo](admin/ambiconnect.png)
# ioBroker.ambiconnect

[![NPM version](https://img.shields.io/npm/v/iobroker.ambiconnect.svg)](https://www.npmjs.com/package/iobroker.ambiconnect)
[![Downloads](https://img.shields.io/npm/dm/iobroker.ambiconnect.svg)](https://www.npmjs.com/package/iobroker.ambiconnect)
![Number of Installations](https://iobroker.live/badges/ambiconnect-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/ambiconnect-stable.svg)

**Tests:** ![Test and Release](https://github.com/iebl/ioBroker.ambiconnect/workflows/Test%20and%20Release/badge.svg)

## AMBIConnect

Bindet eine **Ambibox ambiCHARGE Home** ueber deren MQTT-Schnittstelle (IPC) in
ioBroker ein: alle Messwerte, der Zustand der Ladesitzung und - ausdruecklich
freizuschalten - die Steuerung.

Entwickelt und gemessen an Firmware **0.4.8 (Manny)**.

## Warum kein generischer MQTT-Adapter

Weil ein beschreibbares Zahlenfeld bei dieser Box kein Bedienelement ist,
sondern eine Falle. Die Box nimmt Werte an, die sie nicht fahren kann, und
verliert daran die Ladesitzung - im unguenstigen Fall so, dass nur noch
koerperliches Aus- und Einstecken am Fahrzeug hilft.

Der Adapter bringt deshalb eine Sicherheitsschicht mit (`lib/control.js`), deren
Regeln alle an der realen Box gemessen sind:

- **Untergrenze.** Unterhalb des Arbeitspunkts der Leistungsendstufe loest diese
  aus und beendet die Sitzung. Gemessen: 510 W laufen, 459 W loesen aus. Die Box
  begrenzt *nicht* selbst - sie uebernimmt den Wert wortwoertlich.
- **Null ist keine Pause.** Ein Limit von 0 ohne `stopCharge` haelt rund 66 s,
  dann ist die Sitzung endgueltig weg.
- **Rampe.** Absenkungen laufen in Schritten. Die Box vertraegt deutlich mehr,
  als lange angenommen wurde, aber der Adapter haelt Abstand zum Nachgewiesenen.
- **Stoppen nur im Ladebetrieb.** Ein `stopCharge` waehrend des Startvorgangs
  wirft die Box in `ERROR` und verlangt Neustecken. Er wird zurueckgestellt.
- **Wecken mit Mass.** Ein zweiter `wakeUp` in einen laufenden SLAC-Aufruf
  hinein kippt die Box. Der Adapter liest `wakeUpBlocked` und `replugRequired`,
  statt Wartezeiten anzunehmen.

## Nur ein Regler

Die Box vertraegt **keinen zweiten Regler auf demselben Stellglied**. Laeuft
daneben evcc oder das box-eigene ChargeControl, brechen Ladevorgaenge an
willkuerlichen Punkten ab. Die Steuerpunkte sind deshalb standardmaessig
schreibgeschuetzt; `controlEnabled` schaltet sie frei.

## Objektbaum

| Kanal | Inhalt |
|---|---|
| `info` | Seriennummer, Firmware, Ladeprotokoll, Steuermodus |
| `session` | Sitzungszustand, Fahrzeug verbunden, Neustecken noetig, Weck-Sperre, SoC |
| `measurement` | Leistung AC/DC, Straeme, Spannungen, Frequenz, Temperatur, Energie |
| `limit` | die von der Box gemeldeten Grenzen |
| `control` | Ladegrenze, Sollwert, Wecken, Stoppen (nur nach Freigabe) |

Spannung, Strom und Frequenz kommen mehrfach je Sekunde; der Adapter entprellt
sie ueber Mindestabstand und Totzone, sonst entstehen Millionen
Zustandsaenderungen am Tag.

## Bekannte Eigenheiten der Firmware 0.4.8

- `setSleep` wird **nicht gelesen**. Der Broker nimmt das Topic an, kein Prozess
  der Box wertet es aus. Eine Pause ohne Ladeende gibt es nicht.
- `limitChargePower` hat **keine Rueckmeldung**. Der Sollwert quittiert sich
  selbst; die Wirkung steht in `measurement.powerDc`.
- Das Limit wirkt auf die **DC-Seite**. Die AC-Aufnahme liegt im Teillastbetrieb
  deutlich darueber.
- `inverterError` meldet nur `OTHER_ALARM`. Der genaue Fehlercode steht
  ausschliesslich in den Modbus-Registern 4044 und 4096.

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (huepfman) initial release

## License
MIT License

Copyright (c) 2026 huepfman <trammer@iebl.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.