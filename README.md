# Tidal Stream Deck Controller

A modern Stream Deck plugin to control Tidal with a focus on design and sharing.

## Features

- **Full Control**: Play/Pause, Next, Previous, Volume, Shuffle, and Repeat.
- **Dynamic Display**: Album covers are displayed directly on the Stream Deck buttons.
- **Modern Share Menu**: Press the "Share" button to open a beautiful **Catppuccin Mocha** styled menu on Windows.
- **Ambilight Glow**: The share menu features a symmetrical glow that matches the album art's primary color.
- **DPI Aware**: High-quality rendering even on displays with 125%+ scaling.
- **Prefetching**: Spotify and YouTube links are pre-loaded for instant sharing.

## Requirements

- [Node.js](https://nodejs.org/) installed via NVM on Windows.
- Tidal desktop app with [Tidaluna](https://github.com/Inrixia/TidaLuna) (or compatible API) running on port 24123.

## Installation

1. Copy the `wtf.paul.tidal.sdPlugin` folder to your Stream Deck plugins directory:
   `%AppData%\Elgato\StreamDeck\Plugins\`
2. Restart the Stream Deck software.

## GitHub Push

To push this to your repository:

```bash
cd G:\Projects\streamdeck-tidal
git init
git add .
git commit -m "Initial commit: Tidal Stream Deck Controller"
git branch -M main
git remote add origin https://github.com/SpotifyNutzeer/streamdeck-tidal.git
git push -u origin main
```

---
Created by [SpotifyNutzer](https://github.com/SpotifyNutzeer).
