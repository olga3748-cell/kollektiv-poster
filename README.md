# KOLLEKTIV POSTER 3.3

A single-origin collaborative poster app for Render.

## Deploy on Render

Create a **Web Service** from this GitHub repository.

- Build command: `npm install`
- Start command: `npm start`
- Environment: Node
- No database required.

The server serves the frontend and WebSocket from the same domain:

`https://YOUR-SERVICE.onrender.com/`

WebSocket endpoint:

`wss://YOUR-SERVICE.onrender.com/ws`

## How it works

Six people can enter the same room. Roles are assigned automatically:

1. Background
2. Texture
3. Graphics / drawing
4. Brush
5. Text
6. Typography

State is kept in memory, so a server restart clears the current room. This is intentional for the free prototype.

## Free hosting

Render's free web service can host the Node app. A free service may spin down after inactivity, so the first visit after a quiet period can take a little longer.
