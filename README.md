# Derby MVP

A multiplayer browser-based demolition derby game built with Go and WebSockets.

## Features

* Real-time multiplayer gameplay
* Server-authoritative movement and collision system
* Vehicle damage states
* Automatic respawn system
* Browser-based client (no installation required)
* Custom vehicle sprites and arena map

## Tech Stack

* Go
* WebSockets
* HTML5 Canvas
* JavaScript
* CSS

## Project Structure

```text
derby-mvp/
├── server/
│   └── main.go
├── client/
│   ├── index.html
│   ├── game.js
│   ├── style.css
│   └── assets/
│       ├── cars/
│       └── map/
```

## Running Locally

1. Open a terminal inside the `server` directory.
2. Run:

```bash
go run .
```

3. Open:

```text
http://localhost:8080
```

4. Open multiple tabs or devices to test multiplayer.

## Current Gameplay

Players drive vehicles inside an arena and collide with opponents.

* Server handles all movement validation.
* Collision responses are calculated on the server.
* Vehicles receive damage when hit.
* Destroyed vehicles respawn automatically after 4 seconds.

## Planned Features

* Client-side prediction and reconciliation
* Power-ups
* Arena hazards
* Team game modes
* Scoreboard system
* Audio effects
* Improved destruction mechanics

## Status

Active personal project currently under development.

