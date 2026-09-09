# KOLLEKTIV / POSTER — SIMPLE V1.4 CLEAN

Den här versionen är en genomgången och förenklad variant av SIMPLE V1.3.

## Borttaget
- lokal poster-cache i localStorage
- SLUMPA
- sparade lokala versioner
- oanvänd activity-signal
- gammalt dolt cameraInput-fält
- två dolda chatfraser (MER / MINDRE)
- onödig `state`-payload när ett nytt rum skapas

## Fixat
- nytt rum börjar alltid helt vitt och tomt, både på klient och server
- RENSA använder samma centrala blank-state och rensar hela rummet
- den som föreslår rollbyte måste själv trycka JA/NEJ
- rollshuffle garanterar unik ny roll och försöker undvika samma roll som före bytet
- en ensam deltagare får också en annan roll efter godkänt byte

## Behållet
De avancerade rit-/Paintbrush-renderarna, foto/kamera, CHAOS och den rollbaserade
multiplayer-synken är kvar eftersom de fortfarande används av respektive roller.

Kör:
npm install
npm start
