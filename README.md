# PixDerby

PixDerby is a real-time multiplayer browser demolition derby game built with Go, WebSockets, and HTML5 Canvas.

Players join a shared arena where they control vehicles, collide, survive, and compete in real time.

---

## Demo

Explosion System  
https://github.com/user-attachments/assets/ce21b865-7955-4cf8-911d-2c0aa8b9a293

Boost Pickup System  
https://github.com/user-attachments/assets/6808cc00-acb3-4cc6-9679-bc872f9cf461

Main Menu  
https://github.com/user-attachments/assets/249a527b-c967-4fbd-b7d6-b8566ce16615

---

## About

PixDerby is built around a server-authoritative multiplayer architecture to ensure consistent gameplay across all connected clients.

The focus of the project is on real-time synchronization, physics-based interactions, and lightweight browser-based gameplay without installation.

---

## Key Features

- Real-time multiplayer gameplay
- Server-authoritative movement validation
- Physics-based collisions and damage system
- Explosion effects system
- Random boost pickup mechanics
- Automatic respawn system
- Multiple players in a shared arena
- Browser-based client (no installation required)

---

## Tech Stack

- Go (server, game loop, networking)
- WebSockets (real-time communication)
- JavaScript (client logic)
- HTML5 Canvas (rendering engine)
- CSS (UI layer)

---

## Architecture

The system is divided into two main parts:

**Server (Go)**
- Handles game state
- Validates movement
- Processes collisions
- Synchronizes all clients

**Client (JavaScript)**
- Renders game state
- Handles input
- Sends movement data
- Displays visual effects

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
