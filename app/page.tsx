"use client";

import { useCallback, useEffect, useState } from "react";
import LoginScreen from "@/components/LoginScreen";
import PhotoGrid from "@/components/PhotoGrid";
import PhotoViewer from "@/components/PhotoViewer";
import UploadButton from "@/components/UploadButton";
import { listPhotos, logout, ApiError, type PhotoDTO } from "@/lib/api";

type AuthStatus = "checking" | "signedOut" | "signedIn";

export default function Page() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadFirstPage = useCallback(() => {
    setLoadError(null);
    listPhotos()
      .then((res) => {
        setPhotos(res.photos);
        setNextCursor(res.nextCursor);
        setAuthStatus("signedIn");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setAuthStatus("signedOut");
        } else {
          setAuthStatus("signedIn");
          setLoadError("The album didn't load.");
        }
      });
  }, []);

  useEffect(() => {
    // Fetch-on-mount also doubles as the auth check (401 -> signedOut).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFirstPage();
  }, [loadFirstPage]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listPhotos(nextCursor);
      setPhotos((prev) => [...prev, ...res.photos]);
      setNextCursor(res.nextCursor);
      // A success clears the banner; otherwise one flaky page leaves the
      // error sitting there for the rest of the session.
      setLoadError(null);
    } catch {
      setLoadError("The next batch of photos didn't load.");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleUploaded(photo: PhotoDTO) {
    setPhotos((prev) => [photo, ...prev]);
  }

  function handleDeleted(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setSelectedId(null);
  }

  async function handleLogout() {
    await logout().catch(() => {});
    // Reset every piece of album state, not just the photos: a stale cursor or
    // a still-selected photo id would leak into the next guest's session on a
    // shared phone.
    setPhotos([]);
    setNextCursor(null);
    setSelectedId(null);
    setLoadError(null);
    setAuthStatus("signedOut");
  }

  if (authStatus === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-lg text-chalk-dim">
        Opening the album…
      </div>
    );
  }

  if (authStatus === "signedOut") {
    return <LoginScreen onSuccess={loadFirstPage} />;
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 bg-ink">
        <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
          <h1 className="font-display text-xl font-light">
            Javier <span className="text-foil italic">&amp;</span> Emily
          </h1>
          <button
            type="button"
            onClick={handleLogout}
            className="text-base text-chalk-dim underline underline-offset-4"
          >
            Sign out
          </button>
        </div>
        <UploadButton onUploaded={handleUploaded} />
      </header>

      {loadError && (
        <p role="alert" className="flex items-center justify-center gap-3 px-4 py-3 text-base text-alarm">
          {loadError}
          <button
            type="button"
            onClick={loadFirstPage}
            className="text-chalk underline underline-offset-4"
          >
            Try again
          </button>
        </p>
      )}

      <PhotoGrid photos={photos} onSelect={setSelectedId} />

      {nextCursor && (
        <div className="flex justify-center pb-10">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="rounded-sm border border-rule px-6 py-3 text-lg text-chalk disabled:text-chalk-dim"
          >
            {loadingMore ? "Loading…" : "Load more photos"}
          </button>
        </div>
      )}

      {selectedId && (
        <PhotoViewer
          photos={photos}
          currentId={selectedId}
          onClose={() => setSelectedId(null)}
          onNavigate={setSelectedId}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
