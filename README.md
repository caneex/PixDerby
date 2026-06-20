# PixDerby

PixDerby is a real-time multiplayer browser demolition derby game built with Go, WebSockets, and HTML5 Canvas.

Players control vehicles in a shared arena and attempt to eliminate opponents through collisions while competing for survival.

---

## Overview

PixDerby is designed around a server-authoritative architecture to ensure consistent gameplay and reliable synchronization between connected clients.

The project focuses on:

* Real-time multiplayer networking
* Physics-based vehicle interactions
* Browser accessibility without installation
* Lightweight client-server architecture

---

## Tech Stack

* Go
* WebSockets
* JavaScript
* HTML5 Canvas
* CSS

---

## Features

* Real-time multiplayer gameplay
* Server-authoritative movement validation
* Vehicle collision and damage system
* Explosion effects
* Random boost pickup system
* Automatic respawn system
* Multiple players in a shared arena
* Browser-based client
* Lightweight deployment

---

## Project Structure

```text
pixderby/
├── server/
│   └── main.go
├── client/
│   ├── index.html
│   ├── game.js
│   ├── style.css
│   └── assets/
│       ├── cars/
│       ├── map/
│       └── video/
│           ├── demo_01_explosion.mp4
│           ├── demo_02_boost.mp4
│           └── demo_03_menu.mp4
```

## Current Status

PixDerby is currently under active development.

Implemented systems:

* Multiplayer synchronization
* Vehicle movement and collisions
* Damage handling
* Respawn mechanics
* Explosion effects
* Boost pickups
* Main menu interface

Planned improvements:

* Additional maps
* Sound effects
* Improved visual effects
* Match statistics
* Dedicated server support

---

## Running Locally

### Server

```bash
go run server/main.go
```

### Client

Open `client/index.html` in your browser and connect to the running server.

---

## Screenshots and Videos

Gameplay recordings are available in:

```text
client/assets/video/
```
