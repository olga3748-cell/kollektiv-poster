# KOLLEKTIV / POSTER — Multiplayer V2

Det här är en serverbaserad multiplayer-version. Öppna INTE `public/index.html`
direkt som en lokal fil; då finns ingen Socket.IO-server och rum kan inte fungera.

## Lokalt
1. Installera Node.js 20+
2. I projektmappen:
   npm install
   npm start
3. Öppna:
   http://localhost:3000

Testa multiplayer genom att öppna samma adress i två olika webbläsarfönster.
Skapa rum i det ena, kopiera rumslänken och öppna länken i det andra.

## Render
Ladda upp hela projektmappen till ett Git-repo och skapa en Render Web Service,
eller använd `render.yaml`.

Build command:
npm install

Start command:
npm start

När appen är deployad ska alla deltagare använda SAMMA deployade URL.
En rumslänk ser ut ungefär så här:
https://din-app.onrender.com/?room=ABCDE

## V2-fixar
- Rumslänk använder `?room=ABCDE` i stället för hash.
- Tydligare startskärm: SKAPA RUM / GÅ MED.
- Knappar aktiveras först när servern verkligen är ansluten.
- Tydliga serverfel i UI.
- Socket.IO använder polling + websocket och återansluter automatiskt.
- Återanslutning försöker gå tillbaka till samma rum.
- Delad länk förifyller rumskoden.
- Sixtyfour och UnifrakturMaguntia är borttagna.
- V6.3-funktionerna behålls.
