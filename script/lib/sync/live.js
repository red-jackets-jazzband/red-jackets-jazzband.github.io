/*
   The push channel (docs/device-sync-plan.md, WBS 6.7): one WebSocket to the
   vault's object while the page is visible. The server sends `{version}` on
   connect and after every save; the owner pulls when that is newer than what
   it has. Reconnects back off (1 s doubling to 60 s) and a reconnect needs no
   catch-up code, since the server sends the current version again. Where
   sockets are blocked nothing here fires and the sync-when-it-matters pulls
   (songs/sync/sync.js) still cover it. `connect` and the timers are injected.
*/
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

// The version in a pushed message, or null for anything else (a "pong", junk).
export function parsePushed(data) {
  try {
    const message = JSON.parse(data);
    return message && Number.isInteger(message.version) && message.version >= 0 ? message.version : null;
  } catch {
    return null;
  }
}

export function createLiveChannel({
  connect, onVersion, schedule = setTimeout, cancel = clearTimeout,
}) {
  const state = { socket: null, timer: null, delay: BASE_DELAY_MS, wanted: false, attempt: 0 };

  const retry = () => {
    if (!state.wanted || state.timer) return;
    state.timer = schedule(() => { state.timer = null; open().catch(retry); }, state.delay);
    state.delay = Math.min(state.delay * 2, MAX_DELAY_MS);
  };

  const attach = (socket, attempt) => {
    state.socket = socket;
    socket.onopen = () => { state.delay = BASE_DELAY_MS; };
    socket.onmessage = (event) => {
      const version = parsePushed(event.data);
      if (version !== null) onVersion(version);
    };
    socket.onclose = () => {
      if (state.attempt === attempt) state.socket = null;
      retry();
    };
  };

  async function open() {
    if (!state.wanted || state.socket) return;
    state.attempt += 1;
    const attempt = state.attempt;
    const socket = await connect().catch(() => { return null; }); // offline or no code: try again later
    if (!socket) {
      retry();
    } else if (state.wanted && state.attempt === attempt) {
      attach(socket, attempt);
    } else {
      socket.close();
    }
  }

  return {
    start() {
      state.wanted = true;
      return open();
    },
    stop() {
      state.wanted = false;
      state.attempt += 1;
      if (state.timer) cancel(state.timer);
      state.timer = null;
      state.delay = BASE_DELAY_MS;
      if (state.socket) {
        const socket = state.socket;
        state.socket = null;
        socket.onclose = null;
        socket.close();
      }
    },
    isOpen: () => { return state.socket !== null; },
  };
}
