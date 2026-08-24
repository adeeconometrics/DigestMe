import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, RefObject } from "react";
import {
  hasOlderDigestSessions,
  sortDigestSessionSummaries,
  visibleDigestSessions,
  type DigestSessionSummary,
} from "./chat/session";
import Icon from "./components/Icon";
import { STARTER_DECK } from "./data/starter";
import { deckNameFromFile, validateCsv } from "./lib/csv";
import { getDecksWithStarter, getDigestSessionSummaries, getSessions, putDeck, putSession, removeDeck, removeDigestSession, removeSessionsForDeck } from "./lib/db";
import type { AppView, CsvValidationResult, Deck, Flashcard, Rating, StudySession } from "./types";
import { requestPersistentStorageOnGesture } from "./lib/storagePersistence";

const DigestPage = lazy(() => import("./pages/DigestPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const VIEW_ROUTES = {
  study: "#/study",
  library: "#/library",
  digest: "#/digest",
  settings: "#/settings",
} satisfies Record<AppView, string>;

function viewFromHash(hash: string): AppView {
  if (hash === "#/library") return "library";
  if (hash === "#/digest") return "digest";
  if (hash === "#/settings") return "settings";
  return "study";
}

interface ImportState {
  fileName: string;
  deckName: string;
  validation: CsvValidationResult;
}

interface SessionStats {
  reviewed: number;
  known: number;
  hard: number;
  again: number;
}

const EMPTY_STATS: SessionStats = { reviewed: 0, known: 0, hard: 0, again: 0 };

function makeId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function buildStudyOrder(cards: Flashcard[], randomize: boolean): string[] {
  const order = cards.map((card) => card.id);
  if (!randomize) return order;

  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently added";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function emptyValidation(message: string): CsvValidationResult {
  return {
    headers: [],
    cards: [],
    issues: [{ line: 1, message }],
    headerValid: false,
    valid: false,
  };
}

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setStorageError] = useState("");
  const [sessionHistory, setSessionHistory] = useState<StudySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionStartedAt, setSessionStartedAt] = useState("");
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash));
  const [randomize, setRandomize] = useState(true);
  const [studyOrder, setStudyOrder] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>(EMPTY_STATS);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [toast, setToast] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [renameState, setRenameState] = useState<{ deckId: string; name: string } | null>(null);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("digestme-rail") === "1";
    } catch {
      return false;
    }
  });
  const [openPanel, setOpenPanel] = useState<"sessions" | "decks" | null>(null);
  const [sessionToken, setSessionToken] = useState(0);
  const [focusSession, setFocusSession] = useState<{ id: string; nonce: number } | null>(null);
  const [digestSessions, setDigestSessions] = useState<DigestSessionSummary[]>([]);
  const [activeDigestSessionId, setActiveDigestSessionId] = useState<string | null>(null);
  const [deletedDigestSessionId, setDeletedDigestSessionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleRail(): void {
    setRailCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem("digestme-rail", next ? "1" : "0");
      } catch {
        /* private mode: state still applies for this page load */
      }
      return next;
    });
  }

  function refreshDigestSessions(): void {
    void getDigestSessionSummaries()
      .then(setDigestSessions)
      .catch(() => setDigestSessions([]));
  }

  const handleDigestSessionChange = useCallback((summary: DigestSessionSummary): void => {
    setDigestSessions((previous) => sortDigestSessionSummaries([
      ...previous.filter((candidate) => candidate.id !== summary.id),
      summary,
    ]));
  }, []);

  function togglePanel(panel: "sessions" | "decks"): void {
    if (panel === "sessions") refreshDigestSessions();
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  function openSession(sessionId: string): void {
    setView("digest");
    setFocusSession({ id: sessionId, nonce: Date.now() });
  }

  function beginDigestSession(): void {
    setView("digest");
    setFocusSession(null);
    setSessionToken((token) => token + 1);
  }

  function openSettings(): void {
    setView("settings");
    setOpenPanel(null);
    setMobileMenuOpen(false);
  }

  const activeDeck = decks.find((deck) => deck.id === activeDeckId);
  const currentCardId = studyOrder[currentIndex];
  const currentCard = activeDeck?.cards.find((card) => card.id === currentCardId);
  const totalCards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const progress = isComplete || !studyOrder.length ? (isComplete ? 100 : 0) : (currentIndex / studyOrder.length) * 100;

  useEffect(() => {
    let mounted = true;
    async function hydrateWorkspace() {
      try {
        const [storedDecks, storedSessions, storedDigestSessions] = await Promise.all([
          getDecksWithStarter(),
          getSessions(),
          getDigestSessionSummaries(),
        ]);
        if (!mounted) return;
        setDecks(storedDecks);
        setSessionHistory(storedSessions);
        setDigestSessions(storedDigestSessions);
        setActiveDeckId(storedDecks[0]?.id ?? null);
      } catch {
        if (!mounted) return;
        setStorageError("IndexedDB is unavailable. Changes will last until this page closes.");
        setDecks([STARTER_DECK]);
        setActiveDeckId(STARTER_DECK.id);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void hydrateWorkspace();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => requestPersistentStorageOnGesture(), []);

  useEffect(() => {
    if (isLoading) return;
    if (activeDeckId && decks.some((deck) => deck.id === activeDeckId)) return;
    setActiveDeckId(decks[0]?.id ?? null);
  }, [activeDeckId, decks, isLoading]);

  useEffect(() => {
    if (isLoading) return;
    if (!activeDeck) {
      setStudyOrder([]);
      setCurrentIndex(0);
      setIsComplete(false);
      return;
    }

    setStudyOrder(buildStudyOrder(activeDeck.cards, randomize));
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsComplete(false);
    setSessionStats(EMPTY_STATS);
    startNewSession(activeDeck.id);
  }, [activeDeckId, isLoading, randomize]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Keep the URL hash mapped to the active view so views are linkable
  // while the app stays fully static.
  useEffect(() => {
    const route = VIEW_ROUTES[view];
    if (window.location.hash !== route) window.history.replaceState(null, "", route);
  }, [view]);

  useEffect(() => {
    const handleHashChange = (): void => setView(viewFromHash(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function openImporter() {
    setImportState(null);
    setIsImporterOpen(true);
    setMobileMenuOpen(false);
  }

  function closeImporter() {
    setIsImporterOpen(false);
    setImportState(null);
  }

  const reportStorageFailure = useCallback((message = "IndexedDB could not save that change.") => {
    setStorageError(message);
    setToast(message);
  }, []);

  function persistSession(session: StudySession) {
    void putSession(session)
      .then(() => {
        setSessionHistory((previous) => {
          const existing = previous.some((candidate) => candidate.id === session.id);
          return existing ? previous.map((candidate) => candidate.id === session.id ? session : candidate) : [session, ...previous];
        });
      })
      .catch(() => reportStorageFailure());
  }

  function startNewSession(deckId: string) {
    const startedAt = new Date().toISOString();
    const session: StudySession = {
      id: makeId("session"),
      deckId,
      startedAt,
      updatedAt: startedAt,
      ...EMPTY_STATS,
    };
    setActiveSessionId(session.id);
    setSessionStartedAt(startedAt);
  }

  function saveActiveSession(stats: SessionStats, completed = false) {
    if (!activeDeck || !activeSessionId || !sessionStartedAt) return;
    const updatedAt = new Date().toISOString();
    const session: StudySession = {
      id: activeSessionId,
      deckId: activeDeck.id,
      startedAt: sessionStartedAt,
      updatedAt,
      ...stats,
    };
    if (completed) session.completedAt = updatedAt;
    persistSession(session);
  }

  async function processFile(file: File) {
    const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
    if (!isCsv) {
      setImportState({
        fileName: file.name,
        deckName: deckNameFromFile(file.name),
        validation: emptyValidation("This file is not a CSV. Choose a file ending in .csv."),
      });
      return;
    }

    try {
      const source = await file.text();
      setImportState({
        fileName: file.name,
        deckName: deckNameFromFile(file.name),
        validation: validateCsv(source),
      });
    } catch {
      setImportState({
        fileName: file.name,
        deckName: deckNameFromFile(file.name),
        validation: emptyValidation("The browser could not read this file. Try choosing it again."),
      });
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  function handleImport() {
    if (!importState?.validation.headerValid || !importState.validation.cards.length) return;

    const newDeck: Deck = {
      id: makeId("deck"),
      name: importState.deckName.trim() || deckNameFromFile(importState.fileName),
      sourceFile: importState.fileName,
      createdAt: new Date().toISOString(),
      cards: importState.validation.cards.map((card, index) => ({
        id: makeId(`card-${index}`),
        question: card.question,
        answer: card.answer,
      })),
    };

    setDecks((previous) => [newDeck, ...previous]);
    void putDeck(newDeck).catch(() => reportStorageFailure());
    setActiveDeckId(newDeck.id);
    setView("study");
    closeImporter();
    setToast(`${newDeck.name} is ready to study.`);
  }

  function selectDeck(deckId: string) {
    setActiveDeckId(deckId);
    setView("study");
    setMobileMenuOpen(false);
  }

  function deleteDeck(deckId: string) {
    const deck = decks.find((candidate) => candidate.id === deckId);
    if (!deck || !window.confirm(`Remove ${deck.name} from this session?`)) return;

    const remainingDecks = decks.filter((candidate) => candidate.id !== deckId);
    setDecks(remainingDecks);
    void removeDeck(deckId).catch(() => reportStorageFailure());
    void removeSessionsForDeck(deckId).catch(() => reportStorageFailure("The deck was removed, but its session history could not be cleared."));
    setSessionHistory((previous) => previous.filter((session) => session.deckId !== deckId));
    if (activeDeckId === deckId) setActiveDeckId(remainingDecks[0]?.id ?? null);
    setToast(`${deck.name} was removed from this session.`);
  }

  async function deleteDigestSession(sessionId: string): Promise<void> {
    const session = digestSessions.find((candidate) => candidate.id === sessionId);
    if (!session || !window.confirm(`Delete ${session.title}? Its chat, PDF, and generated DOCX files will be removed from this device.`)) return;

    setDeletedDigestSessionId(sessionId);
    try {
      await removeDigestSession(sessionId);
      setDigestSessions((previous) => previous.filter((candidate) => candidate.id !== sessionId));
      if (activeDigestSessionId !== sessionId) setDeletedDigestSessionId(null);
      setToast(`${session.title} was deleted.`);
    } catch {
      setDeletedDigestSessionId(null);
      reportStorageFailure("The chat session could not be deleted from local storage.");
    }
  }

  function restartSession(shuffle = randomize) {
    if (!activeDeck) return;
    setStudyOrder(buildStudyOrder(activeDeck.cards, shuffle));
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsComplete(false);
    setSessionStats(EMPTY_STATS);
    startNewSession(activeDeck.id);
  }

  function handleRate(rating: Rating) {
    if (!currentCard || !studyOrder.length || !activeDeck || !activeSessionId || !sessionStartedAt) return;

    const nextStats: SessionStats = {
      ...sessionStats,
      reviewed: sessionStats.reviewed + 1,
      [rating]: sessionStats[rating] + 1,
    };
    const isLastCard = currentIndex >= studyOrder.length - 1;
    setSessionStats(nextStats);
    saveActiveSession(nextStats, isLastCard);

    if (isLastCard) {
      setIsComplete(true);
      setIsFlipped(false);
      return;
    }

    setCurrentIndex((index) => index + 1);
    setIsFlipped(false);
  }

  function handleNext() {
    if (!studyOrder.length) return;
    if (currentIndex >= studyOrder.length - 1) {
      saveActiveSession(sessionStats, true);
      setIsComplete(true);
      setIsFlipped(false);
      return;
    }
    saveActiveSession(sessionStats);
    setCurrentIndex((index) => index + 1);
    setIsFlipped(false);
  }

  function saveRename() {
    if (!renameState) return;
    const deck = decks.find((candidate) => candidate.id === renameState.deckId);
    const name = renameState.name.trim();
    if (!deck || !name) return;

    const updatedDeck = { ...deck, name };
    setDecks((previous) => previous.map((candidate) => candidate.id === deck.id ? updatedDeck : candidate));
    void putDeck(updatedDeck).catch(() => reportStorageFailure());
    setRenameState(null);
    setToast("Deck name updated.");
  }

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (isImporterOpen || view !== "study" || !currentCard || isComplete) return;

      if (event.code === "Space") {
        event.preventDefault();
        setIsFlipped((flipped) => !flipped);
      }

      if (isFlipped && (event.key === "1" || event.key === "2" || event.key === "3")) {
        event.preventDefault();
        const rating: Rating = event.key === "1" ? "again" : event.key === "2" ? "hard" : "known";
        handleRate(rating);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNext();
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [currentCard, isComplete, isFlipped, isImporterOpen, view]);

  return (
    <div className={`app-shell ${railCollapsed ? "has-rail" : ""}`}>
      <Sidebar
        activeDeckId={activeDeckId}
        collapsed={railCollapsed}
        decks={decks}
        onDeleteDeck={deleteDeck}
        onDeleteSession={deleteDigestSession}
        onImport={openImporter}
        onNewSession={beginDigestSession}
        onOpenSession={openSession}
        onOpenSettings={openSettings}
        onSelectDeck={selectDeck}
        onSetView={(nextView) => setView(nextView)}
        onToggleCollapse={toggleRail}
        onTogglePanel={togglePanel}
        openPanel={openPanel}
        sessions={digestSessions}
        view={view}
      />

      <main className="main-content">
        <header className="mobile-topbar">
          <div className="mobile-brand">
            <span className="brand-mark"><Icon name="spark" size={17} /></span>
            <span>Digest Me</span>
          </div>
          <button
            aria-expanded={mobileMenuOpen}
            aria-label="Open navigation"
            className="mobile-menu-button icon-button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            type="button"
          >
            <Icon name="menu" size={20} />
          </button>
          {mobileMenuOpen && (
            <MobileMenu
              activeDeckId={activeDeckId}
              decks={decks}
              onImport={openImporter}
              onOpenSettings={openSettings}
              onSelectDeck={selectDeck}
              onSetView={(nextView) => {
                setView(nextView);
                setMobileMenuOpen(false);
              }}
              view={view}
            />
          )}
        </header>

        {view === "settings" ? (
          <Suspense fallback={<div className="loading-workspace"><span className="loading-orbit"><Icon name="lock" size={20} /></span><strong>Opening your study settings...</strong><small>Keeping credentials local to this tab</small></div>}>
            {isLoading ? (
              <div className="loading-workspace"><span className="loading-orbit"><Icon name="lock" size={20} /></span><strong>Opening your study settings...</strong><small>Keeping credentials local to this tab</small></div>
            ) : (
              <SettingsPage
                onBackToStudy={() => setView("study")}
              />
            )}
          </Suspense>
        ) : view === "study" ? (
          <StudyDesk
            activeDeck={activeDeck}
            currentCard={currentCard}
            currentIndex={currentIndex}
            isLoading={isLoading}
            isComplete={isComplete}
            isFlipped={isFlipped}
            onFlip={() => setIsFlipped((flipped) => !flipped)}
            onNext={handleNext}
            onImport={openImporter}
            onRate={handleRate}
            onRestart={() => restartSession()}
            onShuffle={() => restartSession(true)}
            onViewLibrary={() => setView("library")}
            progress={progress}
            randomize={randomize}
            sessionStats={sessionStats}
            setRandomize={setRandomize}
            totalDeckCards={studyOrder.length}
          />
        ) : view === "digest" ? (
          <Suspense fallback={<div className="loading-workspace"><span className="loading-orbit"><Icon name="spark" size={20} /></span><strong>Loading the digest bench...</strong><small>Preparing the local PDF parser</small></div>}>
            <DigestPage
              deletedSessionId={deletedDigestSessionId}
              focusSession={focusSession}
              onSessionChange={handleDigestSessionChange}
              onSessionIdChange={setActiveDigestSessionId}
              onStorageError={reportStorageFailure}
              sessionToken={sessionToken}
            />
          </Suspense>
        ) : (
          <LibraryView
            activeDeckId={activeDeckId}
            decks={decks}
            onDeleteDeck={deleteDeck}
            onImport={openImporter}
            onRenameDeck={(deckId) => {
              const deck = decks.find((candidate) => candidate.id === deckId);
              if (deck) setRenameState({ deckId: deck.id, name: deck.name });
            }}
            onSelectDeck={selectDeck}
            sessionHistory={sessionHistory}
            totalCards={totalCards}
          />
        )}
      </main>

      {isImporterOpen && (
        <ImportDialog
          fileInputRef={fileInputRef}
          importState={importState}
          onChangeFile={handleFileChange}
          onClose={closeImporter}
          onDrop={handleDrop}
          onImport={handleImport}
          onNameChange={(name) => setImportState((previous) => previous ? { ...previous, deckName: name } : previous)}
          onPickFile={() => fileInputRef.current?.click()}
        />
      )}

      {renameState && (
        <RenameDialog
          name={renameState.name}
          onChange={(name) => setRenameState((previous) => previous ? { ...previous, name } : previous)}
          onClose={() => setRenameState(null)}
          onSave={saveRename}
        />
      )}

      {toast && <div className="toast" role="status"><span className="toast-icon"><Icon name="check" size={15} /></span>{toast}</div>}
    </div>
  );
}

interface SidebarProps {
  activeDeckId: string | null;
  collapsed: boolean;
  decks: Deck[];
  openPanel: "sessions" | "decks" | null;
  sessions: DigestSessionSummary[];
  view: AppView;
  onSetView: (view: AppView) => void;
  onToggleCollapse: () => void;
  onTogglePanel: (panel: "sessions" | "decks") => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onNewSession: () => void;
  onSelectDeck: (deckId: string) => void;
  onImport: () => void;
  onDeleteDeck: (deckId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

function Sidebar({
  activeDeckId,
  collapsed,
  decks,
  onDeleteDeck,
  onDeleteSession,
  onImport,
  onNewSession,
  onOpenSession,
  onOpenSettings,
  onSelectDeck,
  onSetView,
  onToggleCollapse,
  onTogglePanel,
  openPanel,
  sessions,
  view,
}: SidebarProps) {
  const [showAllSessions, setShowAllSessions] = useState(false);
  const recentSessions = visibleDigestSessions(sessions, showAllSessions);
  const hasOlderSessions = hasOlderDigestSessions(sessions);

  return (
    <aside className={`sidebar ${collapsed ? "is-rail" : ""}`}>
      <button
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="rail-toggle"
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        type="button"
      >
        <Icon name="chevron-left" size={15} />
      </button>
      <div className="brand-lockup">
        <span className="brand-mark"><Icon name="spark" size={18} /></span>
        <span className="brand-word">Digest Me</span>
      </div>

      <div className="sidebar-label">workspace</div>
      <nav className="main-nav">
        <button
          className={`nav-item ${view === "study" ? "active" : ""}`}
          onClick={() => onSetView("study")}
          title={collapsed ? "Study desk" : undefined}
          type="button"
        >
          <Icon name="book" size={18} />
          <span>Study desk</span>
          {activeDeckId && <span className="nav-indicator" />}
        </button>

        <button
          className={`nav-item nav-trigger ${openPanel === "sessions" ? "is-open" : ""} ${view === "digest" ? "active" : ""}`}
          onClick={() => {
            onSetView("digest");
            if (!collapsed && openPanel !== "sessions") setShowAllSessions(false);
            if (!collapsed) onTogglePanel("sessions");
          }}
          title={collapsed ? "Case digest" : undefined}
          type="button"
        >
          <Icon name="tree" size={18} />
          <span>Case digest</span>
          <Icon className="panel-caret" name="chevron-down" size={14} />
        </button>
        {!collapsed && openPanel === "sessions" && (
          <div className={`sub-panel session-sub-panel ${hasOlderSessions ? "has-session-history" : ""}`}>
            {sessions.length ? (
              <div className="session-history-list">
                {recentSessions.map((session) => (
                  <div className="sub-row session-sub-row" key={session.id}>
                    <button className="sub-item session-sub-item" onClick={() => onOpenSession(session.id)} type="button">
                      <Icon name="tree" size={13} />
                      <span className="session-sub-copy"><strong>{session.title}</strong><small>{formatDate(session.updatedAt)}</small></span>
                    </button>
                    <button aria-label={`Delete ${session.title}`} className="sub-remove" onClick={() => onDeleteSession(session.id)} title="Delete session" type="button">
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                ))}
                {hasOlderSessions && (
                  <button className="sub-item session-history-toggle" onClick={() => setShowAllSessions((expanded) => !expanded)} type="button">
                    <Icon name={showAllSessions ? "chevron-up" : "chevron-down"} size={13} />
                    <span>{showAllSessions ? "Show recent sessions" : `View previous sessions (${sessions.length - recentSessions.length})`}</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="sub-empty">No chat sessions yet.</p>
            )}
            <button className="sub-item sub-new" onClick={onNewSession} type="button">
              <Icon name="plus" size={13} />
              <span>New session</span>
            </button>
          </div>
        )}

        <button
          className={`nav-item nav-trigger ${openPanel === "decks" ? "is-open" : ""} ${view === "library" ? "active" : ""}`}
          onClick={() => {
            onSetView("library");
            if (!collapsed) onTogglePanel("decks");
          }}
          title={collapsed ? "Deck library" : undefined}
          type="button"
        >
          <Icon name="grid" size={18} />
          <span>Deck library</span>
          <Icon className="panel-caret" name="chevron-down" size={14} />
        </button>
        {!collapsed && openPanel === "decks" && (
          <div className="sub-panel">
            {decks.map((deck, index) => (
              <div className={`sub-row ${activeDeckId === deck.id ? "active" : ""}`} key={deck.id}>
                <button className="sub-item" onClick={() => onSelectDeck(deck.id)} type="button">
                  <span className={`deck-dot dot-${index % 4}`} />
                  <span>{deck.name}</span>
                </button>
                <button aria-label={`Remove ${deck.name}`} className="sub-remove" onClick={() => onDeleteDeck(deck.id)} type="button">
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            {decks.length === 0 && <p className="sub-empty">No decks yet.</p>}
            <button className="sub-item sub-new" onClick={onImport} type="button">
              <Icon name="plus" size={13} />
              <span>New deck</span>
            </button>
          </div>
        )}
      </nav>

      <button className="import-prompt" onClick={onImport} title={collapsed ? "Bring your own — drop in a CSV deck" : undefined} type="button">
        <span className="import-prompt-icon"><Icon name="upload" size={17} /></span>
        <span><strong>Bring your own</strong><small>Drop in a CSV deck</small></span>
        <Icon className="prompt-arrow" name="arrow-right" size={16} />
      </button>

      <div className="sidebar-bottom">
        <button aria-current={view === "settings" ? "page" : undefined} className={`profile-row profile-button ${view === "settings" ? "active" : ""}`} onClick={onOpenSettings} title={collapsed ? "Open study settings" : undefined} type="button">
          <span className="avatar small">DS</span>
          <span className="profile-copy"><strong>My study space</strong><small>Personal workspace</small></span>
        </button>
      </div>
    </aside>
  );
}

interface MobileMenuProps {
  activeDeckId: string | null;
  decks: Deck[];
  view: AppView;
  onSetView: (view: AppView) => void;
  onSelectDeck: (deckId: string) => void;
  onImport: () => void;
  onOpenSettings: () => void;
}

function MobileMenu({ activeDeckId, decks, onImport, onOpenSettings, onSelectDeck, onSetView, view }: MobileMenuProps) {
  return (
    <div className="mobile-menu-panel">
      <div className="mobile-nav-links">
        <button className={`nav-item ${view === "study" ? "active" : ""}`} onClick={() => onSetView("study")} type="button"><Icon name="book" size={17} /> Study desk</button>
        <button className={`nav-item ${view === "digest" ? "active" : ""}`} onClick={() => onSetView("digest")} type="button"><Icon name="tree" size={17} /> Case digest</button>
        <button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => onSetView("library")} type="button"><Icon name="grid" size={17} /> Deck library <span className="nav-count">{decks.length}</span></button>
      </div>
      <div className="mobile-deck-heading">your decks</div>
      {decks.slice(0, 4).map((deck, index) => (
        <button className={`mobile-deck-button ${activeDeckId === deck.id ? "selected" : ""}`} key={deck.id} onClick={() => onSelectDeck(deck.id)} type="button">
          <span className={`deck-dot dot-${index % 4}`} /><span>{deck.name}</span><small>{deck.cards.length}</small>
        </button>
      ))}
      <button className="mobile-import-button" onClick={onImport} type="button"><Icon name="upload" size={16} /> Import a CSV</button>
      <button className={`mobile-settings-button ${view === "settings" ? "active" : ""}`} onClick={onOpenSettings} type="button"><Icon name="lock" size={16} /> My study space</button>
    </div>
  );
}

interface StudyDeskProps {
  activeDeck?: Deck;
  currentCard?: Flashcard;
  currentIndex: number;
  totalDeckCards: number;
  isLoading: boolean;
  isFlipped: boolean;
  isComplete: boolean;
  randomize: boolean;
  progress: number;
  sessionStats: SessionStats;
  setRandomize: (value: boolean) => void;
  onFlip: () => void;
  onNext: () => void;
  onRate: (rating: Rating) => void;
  onRestart: () => void;
  onShuffle: () => void;
  onImport: () => void;
  onViewLibrary: () => void;
}

function StudyDesk({
  activeDeck,
  currentCard,
  currentIndex,
  isLoading,
  isComplete,
  isFlipped,
  onFlip,
  onNext,
  onImport,
  onRate,
  onRestart,
  onShuffle,
  onViewLibrary,
  progress,
  randomize,
  sessionStats,
  setRandomize,
  totalDeckCards,
}: StudyDeskProps) {
  return (
    <div className="page study-page">
      <section className="study-intro">
        <div className="intro-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> current session</div>
          <h1>Make it <em>stick.</em></h1>
          <p>Small, focused passes turn good notes into something you can reach for later.</p>
        </div>
        <div className="intro-meta">
          <div className="deck-chip"><span className="deck-dot dot-0" /><span>{activeDeck?.name ?? "No deck selected"}</span></div>
          <div className="intro-meta-stats"><span>{activeDeck?.cards.length ?? 0} cards</span><span className="meta-divider" /><span>{randomize ? "Mixed order" : "Original order"}</span></div>
        </div>
        <div className="intro-orbit orbit-one" />
        <div className="intro-orbit orbit-two" />
        <span className="intro-star star-one">+</span>
        <span className="intro-star star-two">+</span>
      </section>

      {isLoading ? (
        <div className="loading-workspace"><span className="loading-orbit"><Icon name="spark" size={20} /></span><strong>Opening your study space...</strong><small>Checking your local collection</small></div>
      ) : !activeDeck ? (
        <EmptyStudyState onImport={onImport} onViewLibrary={onViewLibrary} />
      ) : (
        <section className="study-layout">
          <div className="study-column">
            <div className="study-toolbar">
              <div className="card-position"><span className="position-current">{isComplete ? "done" : `${String(currentIndex + 1).padStart(2, "0")}`}</span><span className="position-total">/ {String(totalDeckCards).padStart(2, "0")}</span></div>
              <div className="study-tools">
                <button className="tool-button" onClick={onRestart} type="button"><Icon name="refresh" size={15} /> Restart</button>
                <button className={`tool-button ${randomize ? "is-active" : ""}`} onClick={() => setRandomize(!randomize)} type="button"><Icon name="shuffle" size={15} /> Mix cards</button>
              </div>
            </div>

            {isComplete ? (
              <CompletionCard activeDeck={activeDeck} sessionStats={sessionStats} onRestart={onRestart} />
            ) : currentCard ? (
              <>
                <div className="flashcard-stage">
                  <div className="stage-wash" />
                  <div
                    aria-label={isFlipped ? "Answer card. Click to see the question." : "Question card. Click to reveal the answer."}
                    aria-pressed={isFlipped}
                    className={`flashcard ${isFlipped ? "is-flipped" : ""}`}
                    onClick={onFlip}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onFlip();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flashcard-inner">
                      <div aria-hidden={isFlipped} className="flashcard-face card-front">
                        <div className="card-face-top"><span className="face-label">question</span><span className="face-symbol">01</span></div>
                        <div className="question-content"><span className="question-mark">?</span><p>{currentCard.question}</p></div>
                        <div className="card-face-bottom"><span>Click to reveal</span><span className="key-hint">space</span></div>
                      </div>
                      <div aria-hidden={!isFlipped} className="flashcard-face card-back">
                        <div className="card-face-top"><span className="face-label answer-label">answer</span><span className="answer-spark"><Icon name="spark" size={18} /></span></div>
                        <div className="answer-content"><p>{currentCard.answer}</p></div>
                        <div className="card-face-bottom"><span>How did that feel?</span><span className="face-symbol">02</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card-actions">
                  {!isFlipped ? (
                    <div className="pre-answer-actions">
                      <button className="reveal-button" onClick={onFlip} type="button"><span>Reveal answer</span><Icon name="arrow-right" size={17} /></button>
                      <button aria-label="Skip to next card" className="next-card-button" onClick={onNext} type="button"><span>Next card</span><Icon name="arrow-right" size={16} /></button>
                    </div>
                  ) : (
                    <div className="answer-actions">
                      <div className="rating-row">
                      <button className="rating-button again" onClick={() => onRate("again")} type="button"><span className="rating-key">1</span><span><strong>Again</strong><small>Not yet</small></span></button>
                      <button className="rating-button hard" onClick={() => onRate("hard")} type="button"><span className="rating-key">2</span><span><strong>Hard</strong><small>One more look</small></span></button>
                      <button className="rating-button known" onClick={() => onRate("known")} type="button"><span className="rating-key">3</span><span><strong>Got it</strong><small>Feels familiar</small></span></button>
                      </div>
                      <button className="next-card-button" onClick={onNext} type="button"><span>Next card</span><Icon name="arrow-right" size={16} /></button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="loading-card">Preparing your next card...</div>
            )}
          </div>

          <aside className="session-sidebar">
            <div className="session-card progress-card">
              <div className="panel-heading"><span>session progress</span><Icon name="more" size={16} /></div>
              <div className="progress-summary">
                <div className="progress-ring" style={{ background: `conic-gradient(var(--lime) ${progress}%, rgba(255, 255, 255, 0.13) 0)` }}><div className="progress-ring-inner"><strong>{Math.round(progress)}%</strong><small>complete</small></div></div>
                <div className="progress-copy"><strong>{sessionStats.reviewed === 0 ? "A clean slate" : `${sessionStats.reviewed} reviewed`}</strong><span>{Math.max(totalDeckCards - sessionStats.reviewed, 0)} cards left in this pass</span></div>
              </div>
              <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>
            </div>

            <div className="session-card rhythm-card">
              <div className="panel-heading"><span>today's rhythm</span><span className="rhythm-pulse" /></div>
              <div className="rhythm-number"><strong>{sessionStats.known}</strong><span>known this session</span></div>
              <div className="rhythm-bars" aria-hidden="true"><span className="bar-short" /><span className="bar-mid" /><span className="bar-tall" /><span className="bar-mid" /><span className="bar-short" /><span className="bar-tall accent" /><span className="bar-mid" /></div>
              <div className="rhythm-labels"><span>start</span><span>now</span></div>
            </div>

            <div className="tip-card">
              <div className="tip-icon"><Icon name="keyboard" size={17} /></div>
              <div><strong>Keep your hands moving</strong><p>Press space to flip, then 1, 2, or 3 to rate.</p></div>
            </div>

            <button className="shuffle-link" onClick={onShuffle} type="button"><span className="shuffle-link-icon"><Icon name="shuffle" size={15} /></span><span><strong>Feeling brave?</strong><small>Start a fresh mixed pass</small></span><Icon className="shuffle-arrow" name="arrow-right" size={15} /></button>
          </aside>
        </section>
      )}
    </div>
  );
}

function EmptyStudyState({ onImport, onViewLibrary }: { onImport: () => void; onViewLibrary: () => void }) {
  return (
    <div className="empty-study">
      <div className="empty-illustration"><span className="empty-card back" /><span className="empty-card front"><Icon name="plus" size={26} /></span><span className="empty-spark"><Icon name="spark" size={18} /></span></div>
      <div className="eyebrow"><span className="eyebrow-line" /> quiet space, ready</div>
      <h2>Bring a deck to life.</h2>
      <p>Upload a CSV with Question and Answer columns and your next study session is one click away.</p>
      <div className="empty-actions"><button className="primary-button" onClick={onImport} type="button"><Icon name="upload" size={17} /> Import your first CSV</button><button className="text-button" onClick={onViewLibrary} type="button">Browse library <Icon name="arrow-right" size={15} /></button></div>
    </div>
  );
}

function CompletionCard({ activeDeck, sessionStats, onRestart }: { activeDeck: Deck; sessionStats: SessionStats; onRestart: () => void }) {
  return (
    <div className="completion-card">
      <div className="completion-confetti confetti-one" />
      <div className="completion-confetti confetti-two" />
      <span className="completion-icon"><Icon name="check" size={24} /></span>
      <div className="eyebrow"><span className="eyebrow-line" /> pass complete</div>
      <h2>That is a wrap.</h2>
      <p>You made it through <strong>{activeDeck.cards.length} cards</strong> in {activeDeck.name}. A little repetition goes a long way.</p>
      <div className="completion-stats"><div><strong>{sessionStats.known}</strong><span>got it</span></div><div><strong>{sessionStats.hard}</strong><span>hard</span></div><div><strong>{sessionStats.again}</strong><span>again</span></div></div>
      <button className="primary-button" onClick={onRestart} type="button"><Icon name="refresh" size={16} /> Run it back</button>
    </div>
  );
}

interface LibraryViewProps {
  decks: Deck[];
  activeDeckId: string | null;
  totalCards: number;
  sessionHistory: StudySession[];
  onImport: () => void;
  onSelectDeck: (deckId: string) => void;
  onRenameDeck: (deckId: string) => void;
  onDeleteDeck: (deckId: string) => void;
}

function LibraryView({ activeDeckId, decks, onDeleteDeck, onImport, onRenameDeck, onSelectDeck, sessionHistory, totalCards }: LibraryViewProps) {
  return (
    <div className="page library-page">
      <section className="library-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" /> your collection</div><h1>Deck <em>library.</em></h1><p>Everything you want to remember, in one calm corner.</p></div>
        <button className="primary-button" onClick={onImport} type="button"><Icon name="upload" size={17} /> Import CSV</button>
      </section>
      <section className="library-stats">
        <div className="library-stat"><span className="stat-icon mint"><Icon name="layers" size={18} /></span><span><strong>{decks.length}</strong><small>decks ready</small></span></div>
        <div className="library-stat"><span className="stat-icon peach"><Icon name="cards" size={18} /></span><span><strong>{formatNumber(totalCards)}</strong><small>cards in your library</small></span></div>
        <div className="library-stat"><span className="stat-icon lilac"><Icon name="spark" size={18} /></span><span><strong>{sessionHistory.length}</strong><small>study sessions logged</small></span></div>
      </section>
      <div className="library-section-heading"><div><h2>All decks</h2><span>Choose a deck to start a focused pass.</span></div><span className="library-sort"><Icon name="grid" size={14} /> {decks.length} total</span></div>
      {decks.length ? (
        <div className="deck-grid">
          {decks.map((deck, index) => (
            <article className={`deck-card deck-card-${index % 4}`} key={deck.id}>
              <div className="deck-card-top"><span className="deck-card-icon"><Icon name={index % 2 ? "book" : "cards"} size={21} /></span><div className="deck-card-actions"><button aria-label={`Rename ${deck.name}`} className="deck-card-menu" onClick={() => onRenameDeck(deck.id)} type="button"><Icon name="edit" size={15} /></button><button aria-label={`Remove ${deck.name}`} className="deck-card-menu" onClick={() => onDeleteDeck(deck.id)} type="button"><Icon name="trash" size={15} /></button></div></div>
              <div className="deck-card-copy"><h3>{deck.name}</h3><p>From {deck.sourceFile}</p></div>
              <div className="deck-card-meta"><span><Icon name="cards" size={14} /> {deck.cards.length} cards</span><span><Icon name="clock" size={14} /> {formatDate(deck.createdAt)}</span></div>
              <div className="deck-card-progress"><span style={{ width: activeDeckId === deck.id ? "18%" : "0%" }} /></div>
              <button className="deck-study-button" onClick={() => onSelectDeck(deck.id)} type="button"><span>{activeDeckId === deck.id ? "Continue studying" : "Study this deck"}</span><Icon name="arrow-right" size={16} /></button>
            </article>
          ))}
          <button className="add-deck-card" onClick={onImport} type="button"><span className="add-deck-circle"><Icon name="plus" size={21} /></span><strong>Add another deck</strong><small>CSV files only</small></button>
        </div>
      ) : (
        <div className="library-empty"><span className="library-empty-icon"><Icon name="layers" size={24} /></span><h2>Your library is waiting.</h2><p>Import a CSV to create your first deck.</p><button className="primary-button" onClick={onImport} type="button"><Icon name="upload" size={16} /> Import CSV</button></div>
      )}
    </div>
  );
}

interface RenameDialogProps {
  name: string;
  onChange: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
}

function RenameDialog({ name, onChange, onClose, onSave }: RenameDialogProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="rename-title" aria-modal="true" className="import-dialog rename-dialog" role="dialog">
        <div className="dialog-header"><div><div className="eyebrow"><span className="eyebrow-line" /> edit deck</div><h2 id="rename-title">A better <em>name.</em></h2><p>Give this collection a title you will recognize.</p></div><button aria-label="Close rename dialog" className="dialog-close" onClick={onClose} type="button"><Icon name="close" size={19} /></button></div>
        <label className="deck-name-field rename-field"><span>Deck name</span><input autoFocus maxLength={60} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSave(); if (event.key === "Escape") onClose(); }} value={name} /></label>
        <div className="dialog-footer rename-footer"><span className="format-hint"><Icon name="layers" size={15} /> Saved to IndexedDB</span><div className="dialog-actions"><button className="text-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" disabled={!name.trim()} onClick={onSave} type="button"><Icon name="check" size={16} /> Save name</button></div></div>
      </section>
    </div>
  );
}

interface ImportDialogProps {
  importState: ImportState | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onImport: () => void;
  onPickFile: () => void;
  onChangeFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onNameChange: (name: string) => void;
}

function ImportDialog({ importState, fileInputRef, onChangeFile, onClose, onDrop, onImport, onNameChange, onPickFile }: ImportDialogProps) {
  const validation = importState?.validation;
  const canImport = Boolean(validation?.headerValid && validation.cards.length);
  const issueCount = validation?.issues.length ?? 0;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="import-title" aria-modal="true" className="import-dialog" role="dialog">
        <div className="dialog-header"><div><div className="eyebrow"><span className="eyebrow-line" /> new deck</div><h2 id="import-title">Bring your notes <em>to life.</em></h2><p>One CSV in. A focused study session out.</p></div><button aria-label="Close import dialog" className="dialog-close" onClick={onClose} type="button"><Icon name="close" size={19} /></button></div>
        {!importState ? (
          <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <input accept=".csv,text/csv" className="visually-hidden" onChange={onChangeFile} ref={fileInputRef} type="file" />
            <span className="drop-icon"><Icon name="upload" size={23} /></span>
            <strong>Drop your CSV here</strong>
            <span>or <button onClick={(event) => { event.preventDefault(); onPickFile(); }} type="button">browse files</button></span>
            <small>CSV only / stored in IndexedDB on this device</small>
          </label>
        ) : (
          <div className="import-preview-area">
            <div className="selected-file"><span className="file-icon"><Icon name="cards" size={17} /></span><span><strong>{importState.fileName}</strong><small>{validation?.cards.length ?? 0} usable cards found</small></span><button aria-label="Choose a different file" className="change-file-button" onClick={onPickFile} type="button">change</button><input accept=".csv,text/csv" className="visually-hidden" onChange={onChangeFile} ref={fileInputRef} type="file" /></div>
            <label className="deck-name-field"><span>Deck name</span><input maxLength={60} onChange={(event) => onNameChange(event.target.value)} value={importState.deckName} /></label>
            {validation?.valid ? (
              <div className="validation-success"><span><Icon name="check" size={15} /></span><strong>Looks good.</strong> {validation.cards.length} cards are ready to import.</div>
            ) : (
              <div className={`validation-issues ${canImport ? "has-usable" : ""}`}>
                <div className="validation-title"><span className="warning-mark">!</span><span><strong>{canImport ? `${issueCount} ${issueCount === 1 ? "row needs" : "rows need"} attention` : "There is a formatting issue"}</strong><small>{canImport ? "Usable rows can still be imported." : "Fix the CSV and try again."}</small></span></div>
                <div className="issue-list">{validation?.issues.slice(0, 4).map((issue) => <div className="issue-row" key={`${issue.line}-${issue.message}`}><span>line {issue.line}</span><p>{issue.message}</p></div>)}</div>
                {issueCount > 4 && <small className="more-issues">+ {issueCount - 4} more issue{issueCount - 4 === 1 ? "" : "s"}</small>}
              </div>
            )}
            {canImport && !validation?.valid && <div className="partial-import-note"><Icon name="check" size={14} /> Only valid rows will be added to the deck.</div>}
            {validation?.cards.length ? <div className="preview-table"><div className="preview-table-label">preview</div>{validation.cards.slice(0, 3).map((card) => <div className="preview-row" key={`${card.line}-${card.question}`}><span>{card.question}</span><span>{card.answer}</span></div>)}{validation.cards.length > 3 && <div className="preview-more">+ {validation.cards.length - 3} more cards</div>}</div> : null}
          </div>
        )}
        <div className="dialog-footer"><span className="format-hint"><Icon name="book" size={15} /> <strong>Question, Answer</strong> columns required</span><div className="dialog-actions"><button className="text-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" disabled={!canImport} onClick={onImport} type="button"><Icon name="cards" size={16} /> {canImport ? `Import ${validation?.cards.length} cards` : "Choose a CSV"}</button></div></div>
      </section>
    </div>
  );
}
