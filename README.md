# KOLLEKTIV / POSTER — kollektiv (multiplayer) variant

Det här är ett **separat sidoprojekt**. Det är en kopia av posterappen som pratar
med en riktig server i realtid, så flera personer kan jobba i samma poster
samtidigt. Filen ni lämnar in till skolan (`kollektiv_poster_v2_3.html`)
är fortfarande helt fristående — ingen server, ingen synk — och påverkas
inte av något här.

## Vad det här är

- `server.js` — Node.js-server (Express + Socket.IO) som håller reda på rum,
  deltagare, roller och postertillståndet, och skickar ändringar vidare i
  realtid till alla i samma rum.
- `public/index.html` — samma app som solo-varianten, men med multiplayer-
  delarna påslagna (lobbyn, rumskoder, närvarolistan, chatten, röst-rutan
  för formatbyte) istället för avstängda.
- `package.json` — beroenden (`express`, `socket.io`).

## Hur rollerna funkar

När någon skapar eller går med i ett rum får de nästa lediga roll i tur och
ordning: person 1 = BAKGRUND, person 2 = TEXTUR, person 3 = COPYWRITER,
person 4 = TYPSNITT, person 5 = STICKERS, person 6 = TECKNA,
person 7 = PAINTBRUSH, person 8 = FOTOGRAF, person 9 = CHAOS.

Vem som helst kan klicka **BYT ROLL → ROTERA ROLLER ETT STEG** — då flyttas
*alla* i rummet ett steg framåt i den ordningen på en gång, direkt utan att
någon behöver godkänna det. Fortsätter man rotera hinner alla runt alla
roller till slut.

Formatbyte (byta pappersstorlek/orientering) är annorlunda, eftersom det
skalar om hela postern åt alla: den som begär det måste få ja-röster från
*alla* andra i rummet innan det faktiskt byts.

## Köra lokalt

Kräver Node.js 18+.

```bash
cd kollektiv_multiplayer
npm install
npm start
```

Öppna sedan `http://localhost:3000` i flera flikar/enheter för att testa
med flera "personer".

## Driftsätta så att andra kan använda den

Enklast är ett gratis-alternativ som Render.com (eller Railway/Fly.io/
Glitch, samma princip):

1. Lägg upp den här mappen (`kollektiv_multiplayer/`) i ett eget
   Git-repo.
2. Skapa en ny "Web Service" på Render och peka den på repot.
3. Build command: `npm install`. Start command: `npm start`.
4. Render sätter automatiskt miljövariabeln `PORT` — servern lyssnar redan
   på `process.env.PORT`, så inget mer behöver ändras.
5. När den är deployad får ni en adress typ `https://ditt-namn.onrender.com`
   — öppna den, skapa ett rum, och skicka länken (knappen "KOPIERA LÄNK")
   till de andra i gruppen.

## Vad som INTE hänger ihop med det här

`kollektiv_poster_v2_3.html` (den fil som lämnas in) fungerar exakt som
innan — helt utan server. Den här mappen ändrar ingenting i den filen och
är fri att experimentera med, testa på en gratis-server, eller helt enkelt
låta ligga som ett bevis på hur en kollektiv variant skulle kunna se ut.
