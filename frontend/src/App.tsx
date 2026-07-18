import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { socket } from "./lib/ws.js";
import { useAppStore } from "./state/store.js";
import { MatchList } from "./pages/MatchList.js";
import { MatchView } from "./pages/MatchView.js";

export function App() {
  // one global wiring of the socket into the store
  useEffect(() => {
    const store = useAppStore.getState();
    const offMsg = socket.onMessage((msg) => useAppStore.getState().handleServerMessage(msg));
    const offStatus = socket.onStatus((s) => useAppStore.getState().setConnection(s));
    void store;
    return () => {
      offMsg();
      offStatus();
    };
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<MatchList />} />
        <Route path="/match/:fixtureId" element={<MatchView />} />
      </Routes>
    </BrowserRouter>
  );
}
