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
att kika). De enda sätten att faktiskt byta roll är BEGÄR ROLLBYTE (hela
gruppen, allas godkännande) eller BYT ROLL MED… (bara en specifik person,
se "Rollbyte mellan två (swap)" nedan).

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

## Återanslutning

Tidigare frigjordes någons roll — och togs hela rummet bort, om man var
ensam — samma sekund som deras uppkoppling bröts, oavsett orsak. En vanlig
WiFi-blipp, att mobilen låser skärmen, eller att man råkar ladda om fliken
räckte för att antingen kastas ut ur sin roll (i en grupp: någon annan
kunde begära rollbyte och få den) eller, om man var ensam i rummet, tappa
hela postern permanent.

Servern håller nu istället kvar en frånkopplad persons roll (och rummets
poster) i 45 sekunder innan platsen faktiskt frigörs. Under de sekunderna
syns personen i närvarolistan med en nedtonad "· ÅTERANSLUTER…"-markering
istället för att bara försvinna. Kommer man tillbaka inom de 45 sekunderna
— uppkopplingen läker av sig själv, man laddar om sidan, eller öppnar
samma flik igen — återfår man exakt samma roll man hade, istället för att
tilldelas en ny. Det här bygger på en liten identitet webbläsarfliken
sparar själv (`sessionStorage`, inte kopplad till kontot eller enheten på
något annat sätt) och som skickas till servern vid varje anslutning; en
helt annan flik eller enhet får alltid sin egen nya roll, aldrig någon
annans.

Ett medvetet klick på **LÄMNA RUM** frigör däremot platsen direkt utan att
vänta — det är ett aktivt beslut, inte en avbruten uppkoppling.

Väntetiden går att ändra för lokal testning via miljövariabeln
`KOLLEKTIV_RECONNECT_GRACE_MS` (millisekunder; standard 45000).

## Rollbyte mellan två (swap)

Utöver BEGÄR ROLLBYTE (hela gruppen roterar ett steg framåt tillsammans,
se ovan) finns nu ett andra sätt att byta roll: **BYT ROLL MED…**, under
"DIN ROLL" i högerspalten. Man väljer en specifik person i listan och
klickar — bara *den* personen behöver godkänna (inte hela gruppen), och
säger de ja byts de bådas roller direkt med varandra. Ett NEJ avbryter.

Det här är ett komplement, inte en ersättning — gruppens gemensamma
rotation fungerar precis som innan och påverkas inte av ett enskilt byte.
En swap räknas heller inte som ett steg i rotationen: den ändrar bara vem
som har vilken av de roller gruppen redan roterat fram till, den flyttar
ingen närmare (eller längre från) att vara klar. Bara en förfrågan (av
vilket slag som helst — rollbyte, formatbyte, avsluta tidigare, börja om,
eller ett rollbyte-swap) kan pågå åt gången i ett rum.

## KVADRAT-format

Utöver A4 och A3 går det nu att välja **KVADRAT** som pappersformat (samma
BYT FORMAT-ruta som innan, under "interagera"). Kvadrat har ingen
liggande/stående-variant — det alternativet döljs automatiskt så fort
KVADRAT är valt, eftersom det inte skulle betyda något för en kvadrat.
Precis som A4/A3 måste alla i rummet godkänna innan formatet faktiskt
byts, eftersom det skalar om hela postern åt alla.

## Delade takes

"◉ Spara take"-galleriet (samma frysta ögonblicksbilder som i
soloversionen) är nu **delat** i ett rum istället för att bara ligga lokalt
i en enskild webbläsare — sparar någon ett take ser alla andra i rummet
det i samma galleri, direkt.

Utöver manuella klick på "◉ Spara take" sparas nu även **ett take
automatiskt varje gång gruppen roterar roller** (BEGÄR ROLLBYTE, inte
swap-bytet ovan) — så man får en gratis, visuell tidslinje av hur postern
växer fram genom hela sessionen, helt utan att någon behöver komma ihåg
att spara själv.

Att klicka på ett take i galleriet öppnar numera en **förhandsgranskning**
(bild + vem/när) istället för att direkt byta ut den levande postern —
eftersom det skulle drabba *alla* i rummet på en gång, inte bara den som
klickade. Först ett klick till på "GÖR TILL LIVE-POSTER" i den rutan
faktiskt öppnar det taket som allas gemensamma poster (samma
"en person utför det, alla andra synkas"-mönster som formatbyte/börja om).
"STÄNG" lämnar allt orört.

Lämnar man rummet (LÄMNA RUM) växlar galleriet tillbaka till den här
webbläsarens egna, lokala takes, precis som i sololäget.

## Chatthistorik

Chatten (de åtta snabbfraserna) kom tidigare bara fram live — den som
gick med eller kopplade upp sig på nytt mitt i en session såg ett tomt
flöde oavsett hur mycket som redan sagts. Servern minns nu de senaste 30
meddelandena per rum och visar dem direkt (utan ljud eller "NYTT"-märke,
eftersom inget av det faktiskt är nytt) så fort man går med eller kommer
tillbaka.

## Sparat mellan omstarter

Rum, poster, chatt och delade takes låg tidigare bara i serverns minne —
en omstart (en ny driftsättning, en krasch, eller att den fria nivån hos
en värdtjänst som Render.com stänger av servern vid inaktivitet) rensade
tyst bort allt, utan förvarning för den som satt mitt i en session.

Servern sparar nu regelbundet varje rum till en fil (`data/rooms.json`,
skapas automatiskt) och läser in den igen vid start. En omstart hanteras
som "alla i alla rum kopplade från samtidigt" — samma 45-sekunders
återanslutningsfönster som ovan, bara startat direkt vid uppstart istället
för vid en enskild persons uppkopplingsbrott. Kommer man tillbaka (samma
flik, samma återanslutningsidentitet) inom fönstret återfår man sin roll
och sin poster som om inget hänt; annars frigörs platsen som vanligt.

Filens plats går att ändra via miljövariabeln `KOLLEKTIV_PERSIST_PATH`
(används bland annat för att köra flera testservrar parallellt utan att
de skriver över varandras sparade rum). `data/`-mappen är avsiktligt
utelämnad från git (se `.gitignore`) — den är genererad, inget att spara
i ett repo.

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
