"use client";

import { useEffect, useRef, useState } from "react";
import { store } from "@/lib/store";
import { streamTask } from "@/lib/aiClient";

type Mode = "oral" | "video" | "text";
interface Turn {
  role: "ai" | "you";
  text: string;
}

/**
 * The transcript survives leaving the page. It used to live only in React
 * state, so switching tabs mid-interview threw the whole session away.
 * This device only — it is practice, not something to sync.
 */
const SESSION_KEY = "cp_interview_session";

function loadSession(): { mode: Mode; turns: Turn[]; feedback: string } | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(mode: Mode | null, turns: Turn[], feedback: string) {
  try {
    if (!mode || !turns.length) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify({ mode, turns, feedback }));
  } catch {
    /* storage full or blocked — the interview still works, it just won't resume */
  }
}

export default function InterviewPage() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [camError, setCamError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recogRef = useRef<any>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** The turn in flight — "New interview" aborts it so it can't write into the next session. */
  const turnAbort = useRef<AbortController | null>(null);
  /** Read at speak time: the state value was captured when the turn started, so
   *  switching voice off mid-answer still spoke. */
  const voiceRef = useRef(true);
  const starting = useRef(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved?.turns?.length) {
      setMode(saved.mode);
      setTurns(saved.turns);
      setFeedback(saved.feedback || "");
      if (saved.mode === "video") setCamError("Camera is off after leaving the page — start a new video interview to turn it back on.");
    }
  }, []);

  useEffect(() => {
    // Only settled turns are saved; the "…" placeholder is not a turn.
    if (!busy) saveSession(mode, turns, feedback);
  }, [mode, turns, feedback, busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, feedback]);

  useEffect(() => {
    return () => {
      turnAbort.current?.abort();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
      recogRef.current?.stop?.();
    };
  }, []);

  async function start(m: Mode) {
    // A double click started two interviews at once.
    if (starting.current || busy) return;
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — the interviewer reads it.");
    starting.current = true;
    setError("");
    setMode(m);
    setTurns([]);
    setFeedback("");

    if (m === "video") {
      // A second start used to open a new camera stream without closing the first.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = s;
        setTimeout(() => {
          if (videoRef.current) videoRef.current.srcObject = s;
        }, 100);
      } catch {
        setCamError("Camera/mic access denied — continuing without video preview.");
      }
    }
    try {
      await aiTurn([], m);
    } finally {
      starting.current = false;
    }
  }

  function speak(text: string) {
    if (!voiceRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  }

  async function aiTurn(history: Turn[], m: Mode) {
    setBusy(true);
    const resume = store.getResume()!;
    const historyText = history
      .map((t) => `${t.role === "ai" ? "INTERVIEWER" : "CANDIDATE"}: ${t.text}`)
      .join("\n\n");
    const stage =
      history.length < 4 ? "start (warm-up)" : history.length < 10 ? "middle (technical)" : "late (deep/scenario)";
    let acc = "";
    turnAbort.current?.abort();
    const ctrl = new AbortController();
    turnAbort.current = ctrl;
    setTurns([...history, { role: "ai", text: "…" }]);
    try {
      acc = await streamTask(
        "interview_turn",
        { mode: m, history: historyText, resume: resume.text, stage, profile: store.getProfile() },
        (full) => {
          if (!ctrl.signal.aborted) setTurns([...history, { role: "ai", text: full }]);
        },
        // Half a question is still a question; this is practice, not a document.
        { allowIncomplete: true, signal: ctrl.signal }
      );
      if (!ctrl.signal.aborted) speak(acc);
    } catch (err: any) {
      if (ctrl.signal.aborted) return;
      setError(err.message);
      setTurns(history);
    } finally {
      if (turnAbort.current === ctrl) setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!input.trim() || busy || !mode) return;
    // Stop listening first: the recogniser kept running and typed the answer
    // just sent back into the box.
    recogRef.current?.stop?.();
    setListening(false);
    const history: Turn[] = [...turns, { role: "you", text: input.trim() }];
    setInput("");
    setTurns(history);
    await aiTurn(history, mode);
  }

  function toggleMic() {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Speech recognition isn't supported in this browser — use Chrome/Edge, or type your answer.");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const r = new SR();
    recogRef.current = r;
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    let finalText = input;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = (finalText + " " + t).trim();
        else interim += t;
      }
      setInput((finalText + " " + interim).trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    setListening(true);
  }

  async function endInterview() {
    if (turns.length < 2) return setError("Answer at least one question before ending.");
    setBusy(true);
    setError("");
    window.speechSynthesis?.cancel();
    const historyText = turns
      .map((t) => `${t.role === "ai" ? "INTERVIEWER" : "CANDIDATE"}: ${t.text}`)
      .join("\n\n");
    try {
      await streamTask(
        "interview_feedback",
        { history: historyText, profile: store.getProfile() },
        (full) => setFeedback(full),
        { allowIncomplete: true }
      );
      store.bumpStat("interviews");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    turnAbort.current?.abort();
    setBusy(false);
    recogRef.current?.stop?.();
    setListening(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    window.speechSynthesis?.cancel();
    setMode(null);
    setTurns([]);
    setFeedback("");
    setCamError("");
    setError("");
  }

  if (!mode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="h1">Mock Interview</h1>
          <p className="muted mt-1">
            A realistic AI interviewer that reads your resume, probes your answers, and
            gives a frank hire/no-hire report at the end.
          </p>
        </div>
        {error && (
          <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-4">
          <ModeCard
            title="🎙 Oral interview"
            desc="Speak your answers (speech-to-text) and hear the interviewer's voice. Closest to a phone screen."
            onClick={() => start("oral")}
          />
          <ModeCard
            title="🎥 Video interview"
            desc="Camera preview on so you practice eye contact and body language while answering aloud."
            onClick={() => start("video")}
          />
          <ModeCard
            title="⌨ Text interview"
            desc="Type your answers. Good for structuring your thoughts before the real thing."
            onClick={() => start("text")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="h1">
          {mode === "video" ? "🎥 Video" : mode === "oral" ? "🎙 Oral" : "⌨ Text"} interview
        </h1>
        <div className="flex gap-2">
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              const next = !voiceOn;
              voiceRef.current = next;
              setVoiceOn(next);
              if (!next) window.speechSynthesis?.cancel();
            }}
            aria-pressed={voiceOn}
          >
            Voice {voiceOn ? "on 🔊" : "off 🔇"}
          </button>
          {!feedback && (
            <button className="btn-danger text-xs" onClick={endInterview} disabled={busy}>
              End & get feedback
            </button>
          )}
          <button className="btn-secondary text-xs" onClick={reset}>
            New interview
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        {mode === "video" && (
          <div className="card p-3 lg:col-span-1 h-fit">
            {camError ? (
              <p className="text-xs text-amberx-400 p-2">{camError}</p>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full rounded-xl bg-ink-950 aspect-video object-cover"
              />
            )}
            <p className="text-[11px] text-ink-400 mt-2 px-1">
              You&apos;re on camera — sit up, look at the lens, smile. Nothing is recorded
              or uploaded.
            </p>
          </div>
        )}

        <div className={mode === "video" ? "lg:col-span-2 space-y-4" : "lg:col-span-3 space-y-4"}>
          {/* Transcript */}
          <div className="card p-4 max-h-[420px] overflow-auto space-y-3">
            {turns.map((t, i) => (
              <div
                key={i}
                className={`rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  t.role === "ai"
                    ? "bg-ink-850 text-ink-100"
                    : "bg-neon-500/10 border border-neon-500/20 text-ink-200 ml-6"
                }`}
              >
                <span className="block text-[10px] uppercase tracking-wider font-bold mb-1 opacity-60">
                  {t.role === "ai" ? "Interviewer" : "You"}
                </span>
                {t.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Feedback report */}
          {feedback && (
            <div className="card-pad">
              <h2 className="h2 mb-3">📋 Performance report</h2>
              <div className="prose-out">{feedback}</div>
            </div>
          )}

          {/* Answer box */}
          {!feedback && (
            <div className="card p-4 space-y-3">
              <textarea aria-label="Your answer"
                className="input min-h-[90px] resize-y"
                placeholder={
                  mode === "text"
                    ? "Type your answer…"
                    : "Tap the mic and speak — your words appear here (you can edit before sending)…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitAnswer();
                }}
              />
              <div className="flex gap-2 flex-wrap">
                {mode !== "text" && (
                  <button
                    className={listening ? "btn-danger" : "btn-secondary"}
                    onClick={toggleMic}
                    disabled={busy}
                  >
                    {listening ? "◼ Stop mic" : "🎙 Speak"}
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={submitAnswer}
                  disabled={busy || !input.trim()}
                >
                  {busy ? "Interviewer thinking…" : "Send answer"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  title,
  desc,
  onClick,
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card-pad text-left hover:border-neon-500/40 hover:shadow-glow transition group"
    >
      <div className="font-display font-bold text-lg text-ink-100 group-hover:text-neon-400 transition">
        {title}
      </div>
      <p className="text-sm text-ink-300 mt-2 leading-relaxed">{desc}</p>
      <span className="inline-block mt-4 text-sm text-neon-400">Start →</span>
    </button>
  );
}
