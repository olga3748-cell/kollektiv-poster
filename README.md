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

Vem som helst kan klicka **BEGÄR ROLLBYTE** i högerspalten (bredvid
verktygspanelen, under "DIN ROLL"). Det skickar en notis till alla andra i
rummet (samma ruta som dyker upp vid formatbyte), och *alla* måste godkänna
innan något händer — säger någon nej avbryts begäran helt. När alla godkänt
flyttas *alla* i rummet ett steg framåt i rollordningen på en gång. Man är
inte "klar" förrän gruppen har roterat hela vägen runt — dvs alla har haft
alla roller minst en gång — inte bara när någon råkar stå på CHAOS. Så fort
det händer hamnar *alla* i rummet automatiskt på export/rensa-skärmen, utan
att någon behöver klicka på något själv.

Vill gruppen avsluta innan man hunnit rotera igenom alla nio rollerna finns
**AVSLUTA TIDIGARE** under "interagera" i vänsterspalten (bredvid CHATT/BYT
FORMAT). Det är samma sorts begäran — alla andra måste godkänna, ett nej
avbryter helt — men istället för att flytta någons roll hoppar hela gruppen
direkt till export/rensa-skärmen så fort alla sagt ja. Innehållet i fliken
försvinner automatiskt så fort man faktiskt är klar (det finns inget kvar
att begära då) och dyker upp igen om man rensar och börjar om.

Att klicka på en rollknapp i vänsterspalten (t.ex. "CHAOS") byter INTE
roll — de knapparna växlar bara vilken verktygspanel man tittar på bland
de roller man faktiskt får ha just nu (sin egen, plus ett steg bakåt för
att kika). Det enda sättet att faktiskt byta roll är BEGÄR ROLLBYTE och
allas godkännande.

Den gamla soloflödets "GÅ VIDARE"-knapp (som flyttar bara dig själv genom
rollerna) är avstängd i den här varianten, eftersom det inte är ett
gruppbeslut på samma sätt — begär-rollbyte-flödet ersätter den helt.

Formatbyte (byta pappersstorlek/orientering) fungerar på samma sätt: den
som begär det måste få ja-röster från *alla* andra i rummet innan det
faktiskt byts, eftersom det skalar om hela postern åt alla.

Varje ny deltagare får den första lediga rollen (inte bara "nästa i tur och
ordning") — lämnar någon rummet och en ny person går med kan den frigjorda
rollen delas ut igen istället för att krocka med en redan upptagen.

## Chatt och ljud

Ett nytt meddelande i chatten visar en liten röd "NYTT"-markering på
CHATT-fliken om den är stängd, så att man inte missar det — den försvinner
så fort man öppnar fliken.

Under chatten finns två knappar, **POSITIVT LJUD** och **NEGATIVT LJUD**,
som skickar en ljudsignal till alla i rummet direkt (utan text) — bra för
snabb feedback utan att skriva något.

## CHAOS · tre nya effekter

CHAOS hade nio effekter (WARP, MELT, RIPPLE, BLÄCKBLÖDNING, GLITCH, PIXEL,
ECHO, DUBBELEXPONERING, VÄV) — nu finns tre till, under en egen rubrik
"KAOS · SÄRSKILT" i panelen, var och en med ett helt annat sätt att
förvränga postern på än de nio gamla:

- **FÄRGSPLIT** — drar isär bildens röd-, grön- och blåkanal åt olika håll
  (kromatisk aberration), så kanter får färgade kanter istället för att
  hela bilden bara flyttar sig.
- **VIRVEL** — vrider postern i en virvel runt mittpunkten, mer vridning
  närmare mitten än ute vid kanten.
- **SPEGEL** — riktig spegelvänd symmetri: högra halvan speglas tillbaka
  över den vänstra (styrkan avgör hur mycket den blandas med originalet),
  till skillnad från alla andra effekter som bara flyttar/upprepar/
  färgar om samma siluett.

Alla tre fungerar precis som de gamla nio — ett reglage per lager
(HELA POSTERN/BAKGRUND/STICKER/TEXT/FOTO/TECKNING), och REMIX-knappen
kan slumpa fram dem precis som alla andra effekter.

## PAINTBRUSH / METALL

METALL-materialet (flytande metall-penseln under PAINTBRUSH) är gjord
blankare — starkare kontrast mellan ljus och skugga, och en tydligare,
skarpare glansprick längs varje drag. Tidigare kunde tunna drag (låg
GRUNDSTORLEK) nästan försvinna helt eftersom oskärpan som får näraliggande
drag att smälta ihop var en fast storlek oavsett penseltjocklek — ett tunt
drag suddades i praktiken bort innan det hann bli synligt igen. Oskärpan
skalar nu efter det tunnaste aktuella draget, så METALL syns tydligt även
på den lägsta penseltjockleken, medan tjocka drag fortfarande smälter ihop
precis som innan.

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
