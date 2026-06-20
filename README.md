# PixDerby

A real-time multiplayer browser demolition derby game built with Go and WebSockets.

---

## About the project

PixDerby is a physics-based multiplayer arena game where players control cars and try to eliminate each other through collisions.

The project focuses on:
- real-time multiplayer synchronization
- server-authoritative physics
- lightweight browser client (no installation required)

---

## Tech Stack

- Go (backend server + game loop)
- WebSockets (real-time sync)
- JavaScript (client logic)
- HTML5 Canvas (rendering)
- CSS (UI)

---

## Core Features

-  Real-time multiplayer (LAN / localhost)
-  Server-side movement validation
-  Collision + damage system
-  Auto-respawn system
-  Multiple players in one arena
-  Browser-based client

---

##  Project Structure

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
│       └── map/
