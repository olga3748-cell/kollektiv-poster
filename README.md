# Kollektiv Poster v3

Målet: Neocities som frontend + Render som realtidsserver.

## 1. Deploya servern på Render

Lägg innehållet i `server/` i ett GitHub-repo. På Render:
- New -> Web Service
- välj repo
- Build Command: `npm install`
- Start Command: `npm start`
- Free plan

Render stödjer WebSockets på Web Services. Servern använder PORT från miljön.

Kopiera sedan din Render-adress, t.ex. https://kollektiv-poster-server.onrender.com

## 2. Koppla Neocities

Öppna `neocities/index.html` och ersätt:

%%SERVER_URL%%

med din Render-adress.

Exempel:
const SERVER_URL = "https://kollektiv-poster-server.onrender.com";

Ladda upp `index.html` och `style.css` till Neocities.

## 3. Test

Öppna Neocities-sidan på två olika enheter. Skriv samma rumsnamn och tryck ENTER ROOM.
De första sex personerna får roller 1-6 automatiskt.

## PNG

DOWNLOAD PNG laddar ner den aktuella postern från canvasen som PNG. Servern behöver inte spara filen.

## Viktigt

Gratis Render-tjänster kan starta om/pausa efter inaktivitet. Vid första anslutningen efter vila kan det ta ungefär en minut. Själva posterbilden och rummet är inte permanent lagrade på servern.
