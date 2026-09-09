# KOLLEKTIV / POSTER — K/P V2

Fokus i den här versionen:
- Offwhite, handbyggd retro-internet-identitet.
- Större poster och smalare kontrollpanel.
- Deltagarlista är nedtonad, med diskret ● när någon arbetar.
- Fler fasta chattfraser.
- Nytt rollsystem:
  - välj vilken roll du vill begära, oavsett antal spelare;
  - om rollen är ledig får du den efter att övriga godkänt;
  - om rollen är upptagen byter du roll med den personen efter att övriga godkänt;
  - ett NEJ avbryter;
  - den som begär behöver inte rösta;
  - i ett enpersonsrum sker bytet direkt;
  - om någon ritar färdigt genomförs det lokala rollbytet först efter avslutat drag.
- Ett kort WebAudio-pling spelas hos de andra när en rollförfrågan kommer.
- Exportnamn innehåller rumskod och datum.
- Textfältet tappar inte längre fokus när andra skickar state-uppdateringar.
- Första steget mot operationsbaserad multiplayer:
  - textinmatning synkas som små `text-op`;
  - nya ritdrag synkas som `stroke-add`;
  - suddning synkas som `strokes-replace`;
  - full-state finns kvar som fallback för övriga verktyg.

Deploy:
npm install
npm start
