package main

import (
    "encoding/json"
    "log"
    "math"
    "math/rand"
    "net/http"
    "path/filepath"
    "strconv"
    "sync"
    "sync/atomic"
    "time"

    "github.com/gorilla/websocket"
)

type Vec2 struct {
    X float64 `json:"x"`
    Y float64 `json:"y"`
}

type Player struct {
    ID        string  `json:"id"`
    Name      string  `json:"name"`
    Pos       Vec2    `json:"pos"`
    Vel       Vec2    `json:"vel"`
    Dir       Vec2    `json:"-"`
    Angle     float64 `json:"angle"`
    Damage    int     `json:"damage"`
    StageHits int     `json:"-"`
    Stage     int     `json:"stage"`
    Destroyed bool    `json:"destroyed"`
    Kills     int     `json:"kills"`
    Hits      int     `json:"hits"`
    SpeedBoostUntil  float64 `json:"speedBoostUntil"`
    DamageBoostUntil float64 `json:"damageBoostUntil"`
    SizeBoostUntil   float64 `json:"sizeBoostUntil"`
    SizeShieldHits   int     `json:"-"`
    RespawnAt float64 `json:"-"`
    Car       int     `json:"car"`
    StunUntil float64 `json:"-"`
    Boost     bool    `json:"-"`
    BoostMeter float64 `json:"boost"`
    BoostReleaseAt float64 `json:"-"`
    BoostCharge float64 `json:"boostCharge"`
    LastBoost bool `json:"-"`
    BoostHold float64 `json:"-"`
    BoostHeld bool `json:"-"`
    BoostStartMeter float64 `json:"-"`
}

type Box struct {
    ID        int     `json:"id"`
    Pos       Vec2    `json:"pos"`
    Vel       Vec2    `json:"-"`
    State     int     `json:"state"` // 0 intact, 1 broken
    DespawnAt float64 `json:"-"`
    BoostSpawned bool `json:"-"`
}

type Boost struct {
    ID   int    `json:"id"`
    Pos  Vec2   `json:"pos"`
    Type string `json:"type"` // "speed", "hp", "damage"
}

type InputMsg struct {
    Type string  `json:"type"`
    DX   float64 `json:"dx"`
    DY   float64 `json:"dy"`
    Name string  `json:"name"`
    Boost bool   `json:"boost"`
    Car  int     `json:"car"`
    Enabled bool `json:"enabled"`
}

type Event struct {
    Type     string  `json:"type"`
    Target  string  `json:"target"`
    Force   float64 `json:"force"`
    AtX     float64 `json:"x"`
    AtY     float64 `json:"y"`
    Causer  string  `json:"causer"`
}

type StateMsg struct {
    Type    string    `json:"type"`
    Time    float64   `json:"time"`
    Players []*Player `json:"players"`
    Events  []Event   `json:"events"`
    ArenaW  float64   `json:"arenaW"`
    ArenaH  float64   `json:"arenaH"`
    Boxes   []Box     `json:"boxes"`
    Boosts  []Boost   `json:"boosts"`
}

type WelcomeMsg struct {
    Type string `json:"type"`
    ID   string `json:"id"`
}

type Client struct {
    id   string
    conn *websocket.Conn
    send chan []byte
}

type Hub struct {
    clients map[string]*Client
    mu      sync.Mutex
}

func (h *Hub) Add(c *Client) {
    h.mu.Lock()
    defer h.mu.Unlock()
    h.clients[c.id] = c
}

func (h *Hub) Remove(id string) {
    h.mu.Lock()
    defer h.mu.Unlock()
    if c, ok := h.clients[id]; ok {
        close(c.send)
        delete(h.clients, id)
    }
}

func (h *Hub) Broadcast(msg []byte) {
    h.mu.Lock()
    defer h.mu.Unlock()
    for _, c := range h.clients {
        select {
        case c.send <- msg:
        default:
            close(c.send)
            delete(h.clients, c.id)
        }
    }
}

var (
    upgrader = websocket.Upgrader{
        ReadBufferSize:  1024,
        WriteBufferSize: 1024,
        CheckOrigin: func(r *http.Request) bool {
            return true
        },
    }
    idCounter uint64
    debugSizeOnly bool
)

const (
    accel         = 1720.0
    maxSpeed      = 1720.0
    damping       = 0.90
    tickRate      = 60.0
    snapshotRate  = 20.0
    hitDamageBase = 8.0
)

type Hitbox struct {
    Length float64
    Width  float64
}

// Logical hitboxes (independent of sprite PNG size).
// Length/Width are in world units; all stages share the same box per model.
// Tune per model as needed; defaults are sized slightly smaller than visuals.
var hitboxes = []Hitbox{
    {Length: 200, Width: 90},  // car_1
    {Length: 200, Width: 90},  // car_2
    {Length: 200, Width: 90},  // car_3
    {Length: 200, Width: 90},  // car_4
    {Length: 200, Width: 90},  // car_5
    {Length: 200, Width: 90},  // car_6
    {Length: 200, Width: 90},  // car_7
    {Length: 200, Width: 90},  // car_8
    {Length: 200, Width: 90},  // car_9
    {Length: 200, Width: 90},  // car_10
    {Length: 200, Width: 90},  // car_11 (Maybach)
}

var (
    // Tile sizes (map_8.png scaled by 0.25): 888x892 -> 222x223
    tileW = 222.0
    tileH = 223.0
    // Inner playfield (approx ~2500x2500), must be tile-aligned.
    innerCols = 12.0
    innerRows = 12.0
    innerW = innerCols * tileW
    innerH = innerRows * tileH
    // Outer boundary ring (~700px larger), also tile-aligned.
    // Dark boundary ring extends 5 tiles beyond inner playfield on each side.
    outerCols = innerCols + 10.0
    outerRows = innerRows + 10.0
    arenaW = outerCols * tileW
    arenaH = outerRows * tileH
    innerMinX = (arenaW - innerW) / 2.0
    innerMinY = (arenaH - innerH) / 2.0
    innerMaxX = innerMinX + innerW
    innerMaxY = innerMinY + innerH
)

func main() {
    rand.Seed(time.Now().UnixNano())

    hub := &Hub{clients: map[string]*Client{}}
    players := map[string]*Player{}
    var playersMu sync.Mutex

    log.Printf("maxSpeed=%.0f accel=%.0f\n", maxSpeed, accel)
    go gameLoop(hub, players, &playersMu)

    http.Handle("/", http.FileServer(http.Dir("../client")))
    http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
        conn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
            log.Println("upgrade:", err)
            return
        }

        id := strconv.FormatUint(atomic.AddUint64(&idCounter, 1), 10)
        client := &Client{id: id, conn: conn, send: make(chan []byte, 256)}
        hub.Add(client)

        name := r.URL.Query().Get("name")
        if name == "" {
            name = "Driver" + id
        }
        carParam := r.URL.Query().Get("car")
        car := 0
        if carParam != "" {
            if v, err := strconv.Atoi(carParam); err == nil {
                if v >= 0 && v < len(hitboxes) {
                    car = v
                }
            }
        }

        playersMu.Lock()
        players[id] = spawnPlayer(id, name, car)
        playersMu.Unlock()

        welcome, _ := json.Marshal(WelcomeMsg{Type: "welcome", ID: id})
        client.send <- welcome

        go writePump(client)
        go readPump(client, players, &playersMu, hub)
    })

    log.Println("server on http://localhost:8080")
    if err := http.ListenAndServe(":8080", nil); err != nil {
        log.Fatal(err)
    }
}

// approach moves current toward target by at most delta.
func approach(current, target, delta float64) float64 {
    if current < target {
        current += delta
        if current > target {
            current = target
        }
    } else if current > target {
        current -= delta
        if current < target {
            current = target
        }
    }
    return current
}

func spawnPlayer(id, name string, car int) *Player {
    hb := hitboxes[0]
    if car >= 0 && car < len(hitboxes) {
        hb = hitboxes[car]
    }
    radius := math.Hypot(hb.Length*0.5, hb.Width*0.5)
    minX := innerMinX + radius
    maxX := innerMaxX - radius
    minY := innerMinY + radius
    maxY := innerMaxY - radius
    return &Player{
        ID:   id,
        Name: name,
        Pos: Vec2{
            X: rand.Float64()*(maxX-minX) + minX,
            Y: rand.Float64()*(maxY-minY) + minY,
        },
        Vel:       Vec2{},
        Dir:       Vec2{},
        Angle:     0,
        Damage:    0,
        StageHits: 0,
        Stage:     0,
        Destroyed: false,
        Kills:     0,
        Hits:      0,
        SpeedBoostUntil: 0,
        DamageBoostUntil: 0,
        Car:       car,
        StunUntil: 0,
        Boost:     false,
        BoostMeter: 1.0,
        BoostReleaseAt: 0,
        BoostCharge: 0,
        LastBoost: false,
        BoostHold: 0,
        BoostHeld: false,
        BoostStartMeter: 1.0,
    }
}

func readPump(c *Client, players map[string]*Player, playersMu *sync.Mutex, hub *Hub) {
    defer func() {
        c.conn.Close()
        hub.Remove(c.id)
        playersMu.Lock()
        delete(players, c.id)
        playersMu.Unlock()
    }()

    c.conn.SetReadLimit(1024)
    c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    c.conn.SetPongHandler(func(string) error {
        c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
        return nil
    })

    for {
        _, msg, err := c.conn.ReadMessage()
        if err != nil {
            return
        }

        var input InputMsg
        if err := json.Unmarshal(msg, &input); err != nil {
            continue
        }

        playersMu.Lock()
        p, ok := players[c.id]
        if ok {
            if input.Type == "hello" {
                if input.Name != "" {
                    p.Name = sanitizeName(input.Name)
                }
                if input.Car >= 0 && input.Car < len(hitboxes) {
                    p.Car = input.Car
                }
            }
            if input.Type == "input" {
                p.Dir = normalize(Vec2{X: input.DX, Y: input.DY})
                // Update boost with edge detection for release timing.
                if p.LastBoost && !input.Boost {
                    p.BoostReleaseAt = float64(time.Now().UnixNano()) / 1e9
                }
                // Detect boost press to capture starting fuel.
                if !p.LastBoost && input.Boost {
                    p.BoostStartMeter = p.BoostMeter
                    p.BoostHold = 0
                }
                p.BoostHeld = input.Boost
                // Effective boost only when held and fuel available.
                p.Boost = p.BoostHeld && p.BoostMeter > 0
                p.LastBoost = p.BoostHeld
            }
            if input.Type == "debug_size_only" {
                debugSizeOnly = input.Enabled
            }
        }
        playersMu.Unlock()
    }
}

func writePump(c *Client) {
    ticker := time.NewTicker(54 * time.Second)
    defer func() {
        ticker.Stop()
        c.conn.Close()
    }()

    for {
        select {
        case msg, ok := <-c.send:
            if !ok {
                _ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
            if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
                return
            }
        case <-ticker.C:
            c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
            if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
        }
    }
}

func gameLoop(hub *Hub, players map[string]*Player, playersMu *sync.Mutex) {
    tick := time.NewTicker(time.Second / time.Duration(tickRate))
    snap := time.NewTicker(time.Second / time.Duration(snapshotRate))
    defer tick.Stop()
    defer snap.Stop()

    last := time.Now()
    events := []Event{}
    lastHit := map[string]float64{}
    boxes := []Box{}
    boosts := []Boost{}
    nextBoxID := 1
    nextBoostID := 1
    nextBoxSpawnAt := 0.0

    for {
        select {
        case <-tick.C:
            now := time.Now()
            dt := now.Sub(last).Seconds()
            if dt > 0.05 {
                dt = 0.05
            }
            last = now

            playersMu.Lock()
            events = events[:0]
            stepPlayers(players, dt, &events, lastHit, float64(now.UnixNano())/1e9, &boxes, &boosts, &nextBoxID, &nextBoostID, &nextBoxSpawnAt)
            playersMu.Unlock()

        case <-snap.C:
            playersMu.Lock()
            list := make([]*Player, 0, len(players))
            for _, p := range players {
                cp := *p
                list = append(list, &cp)
            }
            out := StateMsg{
                Type:    "state",
                Time:    float64(time.Now().UnixNano()) / 1e9,
                Players: list,
                Events:  events,
                ArenaW:  arenaW,
                ArenaH:  arenaH,
                Boxes:   boxes,
                Boosts:  boosts,
            }
            playersMu.Unlock()

            payload, _ := json.Marshal(out)
            hub.Broadcast(payload)
        }
    }
}

func stepPlayers(players map[string]*Player, dt float64, events *[]Event, lastHit map[string]float64, now float64, boxes *[]Box, boosts *[]Boost, nextBoxID *int, nextBoostID *int, nextBoxSpawnAt *float64) {

    // Spawn new boxes every 7s, up to 7 total.
    if *nextBoxSpawnAt == 0 {
        *nextBoxSpawnAt = now
    }
    for now >= *nextBoxSpawnAt && len(*boxes) < 7 {
        *boxes = append(*boxes, spawnBox(*nextBoxID))
        *nextBoxID++
        *nextBoxSpawnAt += 7.0
    }

    // Update boxes (movement + despawn + boost spawn)
    for i := len(*boxes) - 1; i >= 0; i-- {
        b := &(*boxes)[i]
        if b.State == 1 {
            // Move with damping after knockback
            b.Pos.X += b.Vel.X * dt
            b.Pos.Y += b.Vel.Y * dt
            b.Vel.X *= math.Pow(0.82, dt*60)
            b.Vel.Y *= math.Pow(0.82, dt*60)
            // Clamp inside inner bounds
            boxHalf := 48.0
            if b.Pos.X < innerMinX+boxHalf {
                b.Pos.X = innerMinX + boxHalf
                b.Vel.X = 0
            } else if b.Pos.X > innerMaxX-boxHalf {
                b.Pos.X = innerMaxX - boxHalf
                b.Vel.X = 0
            }
            if b.Pos.Y < innerMinY+boxHalf {
                b.Pos.Y = innerMinY + boxHalf
                b.Vel.Y = 0
            } else if b.Pos.Y > innerMaxY-boxHalf {
                b.Pos.Y = innerMaxY - boxHalf
                b.Vel.Y = 0
            }
            // Spawn boost only after box settles
            if !b.BoostSpawned && math.Hypot(b.Vel.X, b.Vel.Y) < 5 {
                *boosts = append(*boosts, spawnBoost(*nextBoostID, b.Pos))
                *nextBoostID++
                b.BoostSpawned = true
            }
            // Despawn after 2s
            if b.DespawnAt > 0 && now >= b.DespawnAt {
                *boxes = append((*boxes)[:i], (*boxes)[i+1:]...)
            }
        }
    }

    for _, p := range players {
        if p.Destroyed {
            if p.RespawnAt > 0 && now >= p.RespawnAt {
                car := p.Car
                kills := p.Kills
                *p = *spawnPlayer(p.ID, p.Name, car)
                p.Car = car
                p.Kills = kills
            }
            continue
        }

        // Boost logic:
        // - Charge ramps up to max in 1.5s while holding (2.5s if speed boost active)
        // - Stays at max while fuel remains (total fuel lasts 2.5s or 4s for speed boost)
        // - Charge ramps down after release (2s to zero)
        // - Meter refills after 0.5s (3s to full)
        speedBoostActive := p.SpeedBoostUntil > now
        sizeBoostActive := p.SizeBoostUntil > now
        if !sizeBoostActive && p.SizeShieldHits > 0 {
            p.SizeShieldHits = 0
        }
        rampDuration := 1.5
        drainRate := 0.4 // 2.5s
        maxBoostFactor := 2.5
        if speedBoostActive {
            rampDuration = 2.5
            drainRate = 0.25 // 4s
            maxBoostFactor = 5.0
        }
        if p.BoostHeld {
            if p.BoostMeter > 0 {
                // Fuel drains while holding.
                p.BoostMeter -= dt * drainRate
                if p.BoostMeter < 0 {
                    p.BoostMeter = 0
                }
                // Charge ramps to 1.0 over rampDuration but is capped by starting fuel.
                p.BoostHold += dt
                desired := math.Min(1.0, p.BoostHold/rampDuration)
                if desired > p.BoostStartMeter {
                    desired = p.BoostStartMeter
                }
                p.BoostCharge = desired
            } else {
                // No fuel while still holding: charge decays to 0.
                p.BoostCharge -= dt * 0.5
                if p.BoostCharge < 0 {
                    p.BoostCharge = 0
                }
                p.BoostHold = 0
            }
        } else {
            // Not holding: charge decays to 0 in ~2s.
            p.BoostCharge -= dt * 0.5
            if p.BoostCharge < 0 {
                p.BoostCharge = 0
            }
            p.BoostHold = 0
            // Refill fuel when not holding (after short delay), even if charge > 0.
            if now-p.BoostReleaseAt >= 0.5 {
                p.BoostMeter += dt * (1.0 / 3.0) // refills in ~3s
                if p.BoostMeter > 1 {
                    p.BoostMeter = 1
                }
            }
        }
        // Effective boost only when held and fuel available.
        p.Boost = p.BoostHeld && p.BoostMeter > 0
        if p.BoostCharge < 0 {
            p.BoostCharge = 0
        }
        if p.BoostCharge > 1 {
            p.BoostCharge = 1
        }

        // Physics movement: accelerate toward target velocity (Variant B).
        boostFactor := 1.0
        if p.BoostHeld {
            boostFactor = 1.0 + (maxBoostFactor-1.0)*p.BoostCharge
        }
        if now < p.StunUntil {
            // Brief stun to make knockback visible.
            p.Dir = Vec2{}
        }

        maxSpd := maxSpeed * boostFactor

        // Accelerate along input direction, then clamp to max speed.
        p.Vel.X += p.Dir.X * accel * boostFactor * dt
        p.Vel.Y += p.Dir.Y * accel * boostFactor * dt
        speed := math.Hypot(p.Vel.X, p.Vel.Y)
        if speed > maxSpd {
            scale := maxSpd / speed
            p.Vel.X *= scale
            p.Vel.Y *= scale
        }

        p.Pos.X += p.Vel.X * dt
        p.Pos.Y += p.Vel.Y * dt

        p.Vel.X *= math.Pow(damping, dt*60)
        p.Vel.Y *= math.Pow(damping, dt*60)

        if speed > 1 {
            p.Angle = math.Atan2(p.Vel.Y, p.Vel.X)
        }

        // Hard boundary: cannot enter the dark zone. Clamp + damage/knockback.
        radius := getBoundsRadius(p)
        hitBorder := false
        nx, ny := 0.0, 0.0
        if p.Pos.X < innerMinX+radius {
            p.Pos.X = innerMinX + radius
            p.Vel.X = -p.Vel.X * 0.4
            hitBorder = true
            nx = 1
        } else if p.Pos.X > innerMaxX-radius {
            p.Pos.X = innerMaxX - radius
            p.Vel.X = -p.Vel.X * 0.4
            hitBorder = true
            nx = -1
        }
        if p.Pos.Y < innerMinY+radius {
            p.Pos.Y = innerMinY + radius
            p.Vel.Y = -p.Vel.Y * 0.4
            hitBorder = true
            ny = 1
        } else if p.Pos.Y > innerMaxY-radius {
            p.Pos.Y = innerMaxY - radius
            p.Vel.Y = -p.Vel.Y * 0.4
            hitBorder = true
            ny = -1
        }
        if hitBorder {
            key := "border:" + p.ID
            if t, ok := lastHit[key]; !ok || now-t >= 0.18 {
                lastHit[key] = now
                applyStageHit(p)
                applyBorderKnockback(p, nx, ny, now)
                *events = append(*events, Event{Type: "hit", Target: p.ID, Force: 120, AtX: p.Pos.X, AtY: p.Pos.Y, Causer: ""})
            }
        }

        // Box collision (intact only)
        if len(*boxes) > 0 {
            for i := range *boxes {
                b := &(*boxes)[i]
                if b.State != 0 {
                    continue
                }
                boxHalf := 48.0
                dx := b.Pos.X - p.Pos.X
                dy := b.Pos.Y - p.Pos.Y
                dist := math.Hypot(dx, dy)
                if dist < boxHalf+radius {
                    nx := 1.0
                    ny := 0.0
                    if dist > 0.001 {
                        nx = dx / dist
                        ny = dy / dist
                    }
                    // Immediately switch to broken state, then knock back.
                    b.State = 1
                    b.DespawnAt = now + 2.0
                    b.BoostSpawned = false
                    knock := 620.0
                    b.Vel.X = nx * knock
                    b.Vel.Y = ny * knock
                }
            }
        }

        // Boost pickup
        if len(*boosts) > 0 && !p.Destroyed {
            boostHalf := 48.0
            for i := len(*boosts) - 1; i >= 0; i-- {
                bo := (*boosts)[i]
                dx := bo.Pos.X - p.Pos.X
                dy := bo.Pos.Y - p.Pos.Y
                if math.Hypot(dx, dy) < boostHalf+radius {
                    switch bo.Type {
                    case "speed":
                        if p.SpeedBoostUntil < now+4.0 {
                            p.SpeedBoostUntil = now + 4.0
                        }
                        p.BoostMeter += 0.5
                        if p.BoostMeter > 1 {
                            p.BoostMeter = 1
                        }
                    case "hp":
                        healPlayer(p, 2)
                    case "damage":
                        if p.DamageBoostUntil < now+6.0 {
                            p.DamageBoostUntil = now + 6.0
                        }
                    case "size":
                        if p.SizeBoostUntil < now+6.0 {
                            p.SizeBoostUntil = now + 6.0
                        }
                        p.SizeShieldHits = 2
                    }
                    *events = append(*events, Event{Type: "boost_pickup", Target: p.ID, AtX: bo.Pos.X, AtY: bo.Pos.Y, Causer: bo.Type})
                    // Remove boost
                    *boosts = append((*boosts)[:i], (*boosts)[i+1:]...)
                }
            }
        }
    }

    // Collisions
    ids := make([]string, 0, len(players))
    for id := range players {
        ids = append(ids, id)
    }

    for i := 0; i < len(ids); i++ {
        for j := i + 1; j < len(ids); j++ {
            a := players[ids[i]]
            b := players[ids[j]]
            if a.Destroyed || b.Destroyed {
                continue
            }
            if !broadPhase(a, b) {
                continue
            }
            hit, nx, ny, overlap := obbIntersect(a, b)
            if !hit {
                continue
            }
            // Separate along MTV (positional only, no velocity impulse).
            // Larger separation avoids head-on "sticking".
            sep := overlap + 10.0
            a.Pos.X -= nx * sep * 0.5
            a.Pos.Y -= ny * sep * 0.5
            b.Pos.X += nx * sep * 0.5
            b.Pos.Y += ny * sep * 0.5

            // Remove velocity components along the collision normal to prevent pushing/dragging.
            vaN := a.Vel.X*nx + a.Vel.Y*ny
            vbN := b.Vel.X*nx + b.Vel.Y*ny
            if vaN > 0 {
                // A moving into B along +normal (toward B)
                a.Vel.X -= nx * vaN
                a.Vel.Y -= ny * vaN
            }
            if vbN < 0 {
                // B moving into A along -normal
                b.Vel.X -= nx * vbN
                b.Vel.Y -= ny * vbN
            }

            // Register hit immediately on contact (with small cooldown).
            key := a.ID + ":" + b.ID
            if a.ID > b.ID {
                key = b.ID + ":" + a.ID
            }
            if t, ok := lastHit[key]; ok && now-t < 0.12 {
                continue
            }
            lastHit[key] = now

            // Determine attacker based on forward velocity along collision normal.
            va := a.Vel.X*nx + a.Vel.Y*ny
            vb := b.Vel.X*nx + b.Vel.Y*ny
            force := math.Max(50, math.Abs(va-vb)*30)

            if va > vb {
                hits := 1
                if a.DamageBoostUntil > now {
                    hits = 2
                }
                destroyed := applyHits(b, hits)
                if destroyed {
                    a.Kills++
                }
                if now >= b.SizeBoostUntil {
                    applyKnockback(b, nx, ny, force, now)
                }
                *events = append(*events, Event{Type: "hit", Target: b.ID, Force: force, AtX: b.Pos.X, AtY: b.Pos.Y, Causer: a.ID})
            } else if vb > va {
                hits := 1
                if b.DamageBoostUntil > now {
                    hits = 2
                }
                destroyed := applyHits(a, hits)
                if destroyed {
                    b.Kills++
                }
                if now >= a.SizeBoostUntil {
                    applyKnockback(a, -nx, -ny, force, now)
                }
                *events = append(*events, Event{Type: "hit", Target: a.ID, Force: force, AtX: a.Pos.X, AtY: a.Pos.Y, Causer: b.ID})
            } else {
                // Equal contact: separate both and both take a hit.
                sep := overlap*0.7 + 2.0
                a.Pos.X -= nx * sep * 0.5
                a.Pos.Y -= ny * sep * 0.5
                b.Pos.X += nx * sep * 0.5
                b.Pos.Y += ny * sep * 0.5
                hitsA := 1
                hitsB := 1
                if b.DamageBoostUntil > now {
                    hitsA = 2
                }
                if a.DamageBoostUntil > now {
                    hitsB = 2
                }
                destroyedA := applyHits(a, hitsA)
                destroyedB := applyHits(b, hitsB)
                if destroyedA {
                    b.Kills++
                }
                if destroyedB {
                    a.Kills++
                }
                if now >= a.SizeBoostUntil {
                    applyKnockback(a, -nx, -ny, force, now)
                }
                if now >= b.SizeBoostUntil {
                    applyKnockback(b, nx, ny, force, now)
                }
                *events = append(*events, Event{Type: "hit", Target: a.ID, Force: force, AtX: a.Pos.X, AtY: a.Pos.Y, Causer: b.ID})
                *events = append(*events, Event{Type: "hit", Target: b.ID, Force: force, AtX: b.Pos.X, AtY: b.Pos.Y, Causer: a.ID})
            }
        }
    }
}

func getHitbox(p *Player) Hitbox {
    idx := p.Car
    if idx < 0 || idx >= len(hitboxes) {
        hb := hitboxes[0]
        if float64(time.Now().UnixNano())/1e9 < p.SizeBoostUntil {
            hb.Length *= 2
            hb.Width *= 2
        }
        return hb
    }
    hb := hitboxes[idx]
    if float64(time.Now().UnixNano())/1e9 < p.SizeBoostUntil {
        hb.Length *= 2
        hb.Width *= 2
    }
    return hb
}

func getBoundsRadius(p *Player) float64 {
    hb := getHitbox(p)
    halfL := hb.Length * 0.5
    halfW := hb.Width * 0.5
    return math.Hypot(halfL, halfW)
}

func broadPhase(a, b *Player) bool {
    dx := b.Pos.X - a.Pos.X
    dy := b.Pos.Y - a.Pos.Y
    ra := getBoundsRadius(a)
    rb := getBoundsRadius(b)
    maxDist := ra + rb
    return (dx*dx + dy*dy) <= (maxDist * maxDist)
}

func obbIntersect(a, b *Player) (bool, float64, float64, float64) {
    ha := getHitbox(a)
    hb := getHitbox(b)
    aHalfL := ha.Length * 0.5
    aHalfW := ha.Width * 0.5
    bHalfL := hb.Length * 0.5
    bHalfW := hb.Width * 0.5

    ax := math.Cos(a.Angle)
    ay := math.Sin(a.Angle)
    bx := math.Cos(b.Angle)
    by := math.Sin(b.Angle)

    // Axes: A forward/right, B forward/right
    axes := [4][2]float64{
        {ax, ay},
        {-ay, ax},
        {bx, by},
        {-by, bx},
    }

    dx := b.Pos.X - a.Pos.X
    dy := b.Pos.Y - a.Pos.Y

    minOverlap := math.Inf(1)
    nx, ny := 0.0, 0.0

    for i := 0; i < 4; i++ {
        ux := axes[i][0]
        uy := axes[i][1]

        // Projected radii
        ra := math.Abs(ux*ax+uy*ay)*aHalfL + math.Abs(ux*(-ay)+uy*ax)*aHalfW
        rb := math.Abs(ux*bx+uy*by)*bHalfL + math.Abs(ux*(-by)+uy*bx)*bHalfW

        dist := math.Abs(dx*ux + dy*uy)
        overlap := ra + rb - dist
        if overlap <= 0 {
            return false, 0, 0, 0
        }
        if overlap < minOverlap {
            minOverlap = overlap
            nx, ny = ux, uy
        }
    }

    // Ensure normal points from A to B
    if dx*nx+dy*ny < 0 {
        nx = -nx
        ny = -ny
    }
    return true, nx, ny, minOverlap
}

func applyStageHit(p *Player) bool {
    if p.Destroyed {
        return false
    }
    now := float64(time.Now().UnixNano()) / 1e9
    sizeActive := now < p.SizeBoostUntil
    if sizeActive && p.SizeShieldHits > 0 {
        p.SizeShieldHits--
        return false
    }
    p.Hits++
    if p.Hits > 5 {
        p.Hits = 5
    }
    destroyed := setStageFromHits(p)
    if destroyed {
        p.RespawnAt = float64(time.Now().Add(4 * time.Second).UnixNano()) / 1e9
        return true
    }
    return false
}

func applyHits(p *Player, hits int) bool {
    destroyed := false
    for i := 0; i < hits; i++ {
        if applyStageHit(p) {
            destroyed = true
            break
        }
    }
    return destroyed
}

func healPlayer(p *Player, amount int) {
    if p.Destroyed {
        return
    }
    p.Hits -= amount
    if p.Hits < 0 {
        p.Hits = 0
    }
    setStageFromHits(p)
}

func setStageFromHits(p *Player) bool {
    if p.Hits <= 0 {
        p.Stage = 0
        p.StageHits = 0
        p.Damage = 0
        p.Destroyed = false
        return false
    }
    if p.Hits == 1 {
        p.Stage = 1
        p.StageHits = 0
        p.Damage = 1
        p.Destroyed = false
        return false
    }
    if p.Hits == 2 {
        p.Stage = 1
        p.StageHits = 1
        p.Damage = 1
        p.Destroyed = false
        return false
    }
    if p.Hits == 3 {
        p.Stage = 2
        p.StageHits = 0
        p.Damage = 2
        p.Destroyed = false
        return false
    }
    if p.Hits == 4 {
        p.Stage = 2
        p.StageHits = 1
        p.Damage = 2
        p.Destroyed = false
        return false
    }
    // Hits >= 5 -> destroyed
    p.Stage = 3
    p.StageHits = 0
    p.Damage = 3
    p.Destroyed = true
    return true
}

func spawnBox(id int) Box {
    boxHalf := 48.0
    minX := innerMinX + boxHalf
    maxX := innerMaxX - boxHalf
    minY := innerMinY + boxHalf
    maxY := innerMaxY - boxHalf
    return Box{
        ID:    id,
        Pos:   Vec2{X: rand.Float64()*(maxX-minX) + minX, Y: rand.Float64()*(maxY-minY) + minY},
        State: 0,
    }
}

func spawnBoost(id int, pos Vec2) Boost {
    if debugSizeOnly {
        return Boost{ID: id, Pos: pos, Type: "size"}
    }
    r := rand.Intn(4)
    t := "speed"
    if r == 1 {
        t = "hp"
    } else if r == 2 {
        t = "damage"
    } else if r == 3 {
        t = "size"
    }
    return Boost{ID: id, Pos: pos, Type: t}
}

func applyKnockback(p *Player, nx, ny, force float64, now float64) {
    // Strong positional knockback based on map size.
    minSide := math.Min(arenaW, arenaH)
    dist := math.Max(minSide*0.05, math.Min(minSide*0.1, force*0.5))
    p.Pos.X += nx * dist
    p.Pos.Y += ny * dist
    p.Vel.X = 0
    p.Vel.Y = 0
    p.StunUntil = now + 0.18

    // Clamp inside arena.
    radius := getBoundsRadius(p)
    if p.Pos.X < radius {
        p.Pos.X = radius
    } else if p.Pos.X > arenaW-radius {
        p.Pos.X = arenaW - radius
    }
    if p.Pos.Y < radius {
        p.Pos.Y = radius
    } else if p.Pos.Y > arenaH-radius {
        p.Pos.Y = arenaH - radius
    }
}

func applyBorderKnockback(p *Player, nx, ny float64, now float64) {
    // Push player back inside inner bounds.
    dist := math.Max(50, math.Min(120, math.Min(innerW, innerH)*0.05))
    p.Pos.X += nx * dist
    p.Pos.Y += ny * dist
    p.Vel.X = 0
    p.Vel.Y = 0
    p.StunUntil = now + 0.18

    radius := getBoundsRadius(p)
    if p.Pos.X < innerMinX+radius {
        p.Pos.X = innerMinX + radius
    } else if p.Pos.X > innerMaxX-radius {
        p.Pos.X = innerMaxX - radius
    }
    if p.Pos.Y < innerMinY+radius {
        p.Pos.Y = innerMinY + radius
    } else if p.Pos.Y > innerMaxY-radius {
        p.Pos.Y = innerMaxY - radius
    }
}

func normalize(v Vec2) Vec2 {
    mag := math.Hypot(v.X, v.Y)
    if mag < 0.0001 {
        return Vec2{}
    }
    return Vec2{X: v.X / mag, Y: v.Y / mag}
}

func sanitizeName(name string) string {
    if name == "" {
        return "Driver"
    }
    if len(name) > 16 {
        name = name[:16]
    }
    return name
}

func init() {
    // Ensure static path is sane on Windows when running from server folder
    _ = filepath.Clean("../client")
}
