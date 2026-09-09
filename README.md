# KOLLEKTIV / POSTER — Multiplayer V4

Den här versionen är medvetet enklare och bygger på stabila Multiplayer V2.

## Fixat
- Chatten sitter till vänster och består av sex fasta fraser.
- Rollbyte kräver JA från ALLA aktiva deltagare. Ett NEJ avbryter.
- Ett kort ljud spelas när någon annan föreslår rollbyte.
- Roller är unika: två personer kan inte ha samma roll samtidigt. Max 9 personer.
- Rollknapparna är låsta till den roll servern har tilldelat dig.
- Servern slår ihop ändringar per roll i stället för att låta hela postern skriva över varandra.
  Det gör att t.ex. TECKNA, BAKGRUND och COPYWRITER kan arbeta samtidigt.
- PAINTBRUSH-koden är återtagen från stabil V2 och inte ombyggd.
- FOTOGRAF använder riktig getUserMedia-webbkamera på HTTPS/Render.
- TECKNA har RITA / SUDDA. Suddgummit delar bort de delar av draget man drar över.
- Typsnittslistan är nedskalad till 10 tydligare olika systemtypsnitt.

## Kör
npm install
npm start

Öppna http://localhost:3000, eller deploya hela mappen på Render.
Kamera kräver HTTPS eller localhost och webbläsarens kameratillstånd.
