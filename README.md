# KOLLEKTIV POSTER 3.4

Single-origin collaborative poster app for Render.

### New in 3.4
- 7th role: CHAOS
- Role changes require approval from every currently connected participant
- Role changes swap roles when the requested role is occupied
- More textures: dots, lines, cross, grid, waves, speckle, noise
- Noise is gray/white instead of painting the image black
- Multiple independent text layers
- Text layer color, position and visibility
- Chaos modes: jitter, warp, glitch, rotation
- Chaos influences background, texture, graphics, brush and typography

### Render
Build: `npm install`
Start: `npm start`

The app and WebSocket share the same origin. WebSocket endpoint is `/ws`.

State is in memory for the free prototype and resets if the service restarts.
