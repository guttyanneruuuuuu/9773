# Picnic Comet Rally

A colorful portrait-browser party game that can run from static hosting such as GitHub Pages. Create a room, exchange invite text with a friend, or play instantly against a bot.

## Play locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser.

## GitHub Pages

The game is a plain static site: `index.html`, `styles.css`, and `src/game.js`. No build step or backend is required.

## Friend rooms

Friend rooms use direct WebRTC data channels with manual invite/answer text, so the game can stay fully static:

1. Host chooses **友達ルームを作る** and copies the invite text.
2. Guest chooses **招待で参加**, pastes the invite, and copies the answer text.
3. Host pastes the answer and starts the match.

If WebRTC cannot connect because of a restrictive network, the bot match remains available.
