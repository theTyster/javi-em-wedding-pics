"use client";

import { useState, type FormEvent } from "react";
import { login, ApiError } from "@/lib/api";

export default function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center px-7 py-16">
      <div className="mx-auto w-full max-w-80">
        {/* The one loud moment in the app: the names set as a type treatment.
            "Javier" is indented so the ampersand hangs off the names' left edge
            without ever reaching past the page margin. Everything past the
            rule is deliberately quiet. */}
        <h1 className="font-display text-[3rem] font-light leading-[0.95] tracking-tight">
          <span className="block pl-[0.62em]">Javier</span>
          <span className="block">
            <span className="text-foil italic">&amp;</span> Emily
          </span>
        </h1>

        <hr className="my-8 border-0 border-t border-rule" />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label htmlFor="invite-password" className="text-lg leading-relaxed text-chalk-dim">
            Enter the password to see the photos and add your own.
          </label>

          <input
            id="invite-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-4 text-xl tracking-wide"
          />

          {error && (
            <p role="alert" className="text-lg text-alarm">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-sm bg-foil px-4 py-4 text-xl font-semibold text-ink disabled:bg-foil-deep disabled:text-ink/60"
          >
            {loading ? "Opening…" : "Open the album"}
          </button>
        </form>
      </div>
    </div>
  );
}
