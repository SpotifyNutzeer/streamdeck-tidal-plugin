// Stream Deck Plugin for Tidal (via Tidaluna) - Version 1.6.2 (Tighter Symmetrical Glow)
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');

const logFile = path.join(__dirname, 'plugin_debug.log');
function log(msg) {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()}: ${msg}\n`); } catch (e) {}
}

log("--- OPTIMIZED UI STARTING (v1.6.2) ---");

process.on('uncaughtException', (err) => {
    log(`CRITICAL ERROR: ${err.message}\n${err.stack}`);
});

let websocket = null;
let pluginUUID = null;
let tidalWs = null;
const allContexts = new Set();
const playPauseContexts = new Set();

let currentCoverBase64 = "";
let currentTitle = "Tidal";
let currentArtist = "Ready";
let currentTrackUrl = "";
let currentVibrantColor = "#89b4fa"; 
let currentOptions = null;
let isPlaying = false;

function escapeXml(unsafe) {
    if (!unsafe) return "";
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function truncate(str, len) {
    if (str && str.length > len) return str.substring(0, len - 2) + "..";
    return str || "";
}

function generateStyledImage() {
    const title = escapeXml(truncate(currentTitle, 14));
    const artist = escapeXml(truncate(currentArtist, 18));
    const bgImage = currentCoverBase64 ? "data:image/jpeg;base64," + currentCoverBase64 : ""; 

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">';
    svg += '<rect width="144" height="144" fill="#1e1e2e" />';
    if (bgImage) svg += '<image href="' + bgImage + '" width="144" height="144" preserveAspectRatio="xMidYMid slice" />';
    svg += '<defs><linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#1e1e2e;stop-opacity:0" /><stop offset="100%" style="stop-color:#1e1e2e;stop-opacity:0.9" /></linearGradient></defs>';
    svg += '<rect y="60" width="144" height="84" fill="url(#grad)" />';
    svg += '<text x="72" y="105" font-family="Arial, sans-serif" font-size="20" fill="#cdd6f4" font-weight="bold" text-anchor="middle">' + title + '</text>';
    svg += '<text x="72" y="130" font-family="Arial, sans-serif" font-size="16" fill="#89dceb" text-anchor="middle">' + artist + '</text>';
    if (!isPlaying) svg += '<circle cx="125" cy="19" r="8" fill="#f38ba8" stroke="#cdd6f4" stroke-width="2" />';
    svg += '</svg>';

    return "data:image/svg+xml;base64," + Buffer.from(svg.trim()).toString('base64');
}

function updateAllButtons() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    const imageUri = generateStyledImage();
    allContexts.forEach(context => {
        websocket.send(JSON.stringify({ "event": "setImage", "context": context, "payload": { "image": imageUri, "target": 0 } }));
        websocket.send(JSON.stringify({ "event": "setTitle", "context": context, "payload": { "title": "", "target": 0 } }));
    });
}

function prefetchLinks(url) {
    if (!url || !url.startsWith('http')) return;
    https.get(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const links = json.linksByPlatform;
                const options = [];
                if (links.spotify) options.push({ name: 'Spotify', url: links.spotify.url, color: '#a6e3a1' });
                if (links.tidal) options.push({ name: 'Tidal', url: links.tidal.url, color: '#89dceb' });
                if (links.youtube) options.push({ name: 'YouTube', url: links.youtube.url, color: '#f38ba8' });
                currentOptions = options.length > 0 ? options : null;
            } catch (e) { currentOptions = null; }
        });
    }).on('error', () => { currentOptions = null; });
}

function processTidalData(data) {
    let changed = false;
    let newVibrant = data.vibrantColor || (data.album && data.album.vibrantColor);
    if (newVibrant && currentVibrantColor !== newVibrant) { currentVibrantColor = newVibrant; changed = true; }

    let foundUrl = data.url || data.shareUrl || (data.track && data.track.url);
    if (!foundUrl && data.field === 'url') foundUrl = data.value;
    if (foundUrl && foundUrl !== currentTrackUrl) {
        currentTrackUrl = foundUrl.replace('www.tidal.com', 'listen.tidal.com');
        currentOptions = null;
        prefetchLinks(currentTrackUrl);
    }

    if (data.field && data.hasOwnProperty('value')) {
        const f = data.field; let v = data.value;
        if (f === 'title' || f === 'track') {
            if (typeof v === 'object' && v !== null) v = v.title || v.track || "";
            if (currentTitle !== v) { currentTitle = v; changed = true; }
        } else if (f === 'artist') {
            if (typeof v === 'object' && v !== null) v = v.name || "";
            if (currentArtist !== v) { currentArtist = v; changed = true; }
        } else if (f === 'playing') {
            if (isPlaying !== v) { isPlaying = v; changed = true; updatePlayPauseState(isPlaying); }
        } else if (f === 'coverUrl' && v) fetchCoverArt(v);
    } else {
        let nt = data.track || data.title;
        if (typeof nt === 'object' && nt !== null) nt = nt.title || nt.track || "";
        if (nt && currentTitle !== nt) { currentTitle = nt; changed = true; }
        let na = data.artist;
        if (typeof na === 'object' && na !== null) na = na.name || "";
        if (na && currentArtist !== na) { currentArtist = na; changed = true; }
        if (data.hasOwnProperty('playing') && isPlaying !== data.playing) { isPlaying = data.playing; changed = true; updatePlayPauseState(isPlaying); }
        let nc = data.coverUrl || (data.album && data.album.coverUrl);
        if (nc) fetchCoverArt(nc); else if (changed) updateAllButtons();
    }
}

function fetchCoverArt(url) {
    let fUrl = url.replace(/\d+x\d+\.jpg/, '320x320.jpg');
    if (!fUrl.startsWith('http')) return;
    https.get(fUrl, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (buffer.length > 0) { currentCoverBase64 = buffer.toString('base64'); updateAllButtons(); }
        });
    }).on('error', () => {});
}

function showPowerShellMenu(options, context) {
    const title = (currentTitle).replace(/"/g, "'");
    const artist = (currentArtist).replace(/"/g, "'");
    const coverPath = path.join(process.env.TEMP, 'tidal_cover.jpg');
    if (currentCoverBase64) fs.writeFileSync(coverPath, Buffer.from(currentCoverBase64, 'base64'));
    const glow = currentVibrantColor || "#89b4fa";
    const escapedCoverPath = coverPath.split('\\').join('\\\\');

    let btns = "";
    options.forEach((opt, i) => {
        btns += "$b" + i + "=New-Object Windows.Forms.Button;$b" + i + ".Text='Copy " + opt.name + " Link';$b" + i + ".Location=New-Object Drawing.Point(50," + (300 + (i * 50)) + ");$b" + i + ".Size=New-Object Drawing.Size(300,40);$b" + i + ".FlatStyle='Flat';$b" + i + ".FlatAppearance.BorderColor=[Drawing.ColorTranslator]::FromHtml('" + opt.color + "');$b" + i + ".ForeColor=[Drawing.ColorTranslator]::FromHtml('" + opt.color + "');$b" + i + ".Font=New-Object Drawing.Font('Segoe UI',10,1);$b" + i + ".Tag='" + opt.url + "';$b" + i + ".Add_Click({Set-Clipboard -Value $this.Tag;$form.Close()});$form.Controls.Add($b" + i + ");";
    });

    const ps = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        
        $dpiCode = @'
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
'@
        $dpiType = Add-Type -MemberDefinition $dpiCode -Name "Win32DPI" -Namespace "Win32" -PassThru
        [Win32.Win32DPI]::SetProcessDPIAware() | Out-Null

        [Windows.Forms.Application]::EnableVisualStyles()
        $form = New-Object Windows.Forms.Form
        $form.Text = "Share"
        $form.Size = New-Object Drawing.Size(400, ${380 + (options.length * 50)})
        $form.StartPosition = "CenterScreen"
        $form.BackColor = [Drawing.ColorTranslator]::FromHtml("#1e1e2e")
        $form.ForeColor = [Drawing.ColorTranslator]::FromHtml("#cdd6f4")
        $form.FormBorderStyle = "FixedDialog"
        $form.Topmost = $true

        $form.Add_Paint({
            $g = $_.Graphics
            $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            
            # Symmetrical Tighter Glow:
            # Image is 200x200 at (100, 20). 
            # Glow is 250x250 at (75, -5) -> 25px margin on all sides.
            $glowRect = New-Object Drawing.Rectangle(75, -5, 250, 250)
            $gp = New-Object Drawing.Drawing2D.GraphicsPath
            $r = 50 # Softness
            $gp.AddArc($glowRect.X, $glowRect.Y, $r, $r, 180, 90)
            $gp.AddArc($glowRect.Right - $r, $glowRect.Y, $r, $r, 270, 90)
            $gp.AddArc($glowRect.Right - $r, $glowRect.Bottom - $r, $r, $r, 0, 90)
            $gp.AddArc($glowRect.X, $glowRect.Bottom - $r, $r, $r, 90, 90)
            $gp.CloseFigure()

            $pbg = New-Object Drawing.Drawing2D.PathGradientBrush($gp)
            $pbg.CenterColor = [Drawing.Color]::FromArgb(160, [Drawing.ColorTranslator]::FromHtml("${glow}"))
            $pbg.SurroundColors = @([Drawing.Color]::FromArgb(0, 30, 30, 46))
            $g.FillPath($pbg, $gp)
        })

        if (Test-Path "${escapedCoverPath}") {
            $p = New-Object Windows.Forms.PictureBox
            $p.Image = [Drawing.Image]::FromFile("${escapedCoverPath}")
            $p.SizeMode = 1
            $p.Size = New-Object Drawing.Size(200, 200)
            $p.Location = New-Object Drawing.Point(100, 20)
            
            $rect = New-Object Drawing.Rectangle(0, 0, $p.Width, $p.Height)
            $igp = New-Object Drawing.Drawing2D.GraphicsPath
            $ir = 40
            $igp.AddArc($rect.X, $rect.Y, $ir, $ir, 180, 90)
            $igp.AddArc($rect.Right - $ir, $rect.Y, $ir, $ir, 270, 90)
            $igp.AddArc($rect.Right - $ir, $rect.Bottom - $ir, $ir, $ir, 0, 90)
            $igp.AddArc($rect.X, $rect.Bottom - $ir, $ir, $ir, 90, 90)
            $igp.CloseFigure()
            $p.Region = New-Object Drawing.Region($igp)
            $form.Controls.Add($p)
            $p.BringToFront()
        }

        $lt = New-Object Windows.Forms.Label; $lt.Text = "${title}"; $lt.Location = New-Object Drawing.Point(20, 230); $lt.Size = New-Object Drawing.Size(360, 30); $lt.TextAlign = 32; $lt.Font = New-Object Drawing.Font("Segoe UI", 14, 1); $form.Controls.Add($lt)
        $la = New-Object Windows.Forms.Label; $la.Text = "${artist}"; $la.Location = New-Object Drawing.Point(20, 260); $la.Size = New-Object Drawing.Size(360, 25); $la.TextAlign = 32; $la.ForeColor = [Drawing.ColorTranslator]::FromHtml("#89dceb"); $la.Font = New-Object Drawing.Font("Segoe UI", 11); $form.Controls.Add($la)
        ${btns}
        $form.ShowDialog() | Out-Null
    `;

    const temp = path.join(process.env.TEMP, 'tidal_share.ps1');
    fs.writeFileSync(temp, ps, 'utf8');
    exec("powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"" + temp + "\"", () => {
        try { fs.unlinkSync(temp); if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath); } catch(e) {}
    });
}

function connectTidalWebSocket() {
    try {
        tidalWs = new WebSocket('ws://localhost:24123');
        tidalWs.on('open', () => { 
            tidalWs.send(JSON.stringify({ action: "subscribe", fields: ["coverUrl", "track", "title", "artist", "playing", "album", "url", "vibrantColor"] })); 
        });
        tidalWs.on('message', (data) => { try { processTidalData(JSON.parse(data)); } catch (e) {} });
        tidalWs.on('close', () => { setTimeout(connectTidalWebSocket, 5000); });
    } catch (e) { setTimeout(connectTidalWebSocket, 5000); }
}

function updatePlayPauseState(playing) {
    playPauseContexts.forEach(context => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ "event": "setState", "context": context, "payload": { "state": playing ? 1 : 0 } }));
        }
    });
}

function sendTidalCommand(endpoint, body = null, context = null) {
    const options = { hostname: 'localhost', port: 24123, path: '/' + endpoint, method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const req = http.request(options, (res) => {
        if (res.statusCode === 200 && context && websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ "event": "showOk", "context": context }));
        }
    });
    req.on('error', () => {
        if (context && websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ "event": "showAlert", "context": context }));
        }
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
}

function getTidalState(callback) {
    const options = { hostname: 'localhost', port: 24123, path: '/', method: 'GET' };
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { try { callback(JSON.parse(data)); } catch (e) { callback(null); } });
    });
    req.on('error', () => callback(null));
    req.end();
}

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent) {
    pluginUUID = inPluginUUID;
    try {
        websocket = new WebSocket("ws://127.0.0.1:" + inPort);
        websocket.onopen = () => {
            websocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": pluginUUID }));
            connectTidalWebSocket();
        };
        websocket.onmessage = (evt) => {
            try {
                const { event, action, context } = JSON.parse(evt.data);
                if (event === "keyDown") {
                    if (action === "wtf.paul.tidal.share") {
                        if (currentOptions) showPowerShellMenu(currentOptions, context); 
                        else websocket.send(JSON.stringify({ "event": "showAlert", "context": context }));
                    } else {
                        switch (action) {
                            case "wtf.paul.tidal.playpause": sendTidalCommand('toggle', null, context); break;
                            case "wtf.paul.tidal.next": sendTidalCommand('next', null, context); break;
                            case "wtf.paul.tidal.prev": sendTidalCommand('previous', null, context); break;
                            case "wtf.paul.tidal.shuffle": getTidalState((s) => s ? sendTidalCommand('setShuffleMode', { shuffle: !s.shuffle }, context) : null); break;
                            case "wtf.paul.tidal.repeat": getTidalState((s) => s ? sendTidalCommand('setRepeatMode', { mode: (s.repeatMode + 1) % 3 }, context) : null); break;
                            case "wtf.paul.tidal.volup": sendTidalCommand('volume', { volume: "+5" }, context); break;
                            case "wtf.paul.tidal.voldown": sendTidalCommand('volume', { volume: "-5" }, context); break;
                        }
                    }
                } else if (event === "willAppear") {
                    allContexts.add(context);
                    if (action === "wtf.paul.tidal.playpause") playPauseContexts.add(context);
                    getTidalState((state) => { if (state) processTidalData(state); else updateAllButtons(); });
                } else if (event === "willDisappear") {
                    allContexts.delete(context);
                    playPauseContexts.delete(context);
                }
            } catch (e) {}
        };
    } catch (e) {}
}

const args = process.argv;
let port, uuid, event;
for (let i = 0; i < args.length; i++) {
    if (args[i] === "-port") port = args[i + 1];
    if (args[i] === "-pluginUUID") uuid = args[i + 1];
    if (args[i] === "-registerEvent") event = args[i + 1];
}
if (port && uuid && event) connectElgatoStreamDeckSocket(port, uuid, event);
