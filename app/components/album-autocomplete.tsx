import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Icon } from "#app/components/ui/icon";
import { cn } from "#app/utils/misc";

interface Album {
  id: string;
  name: string;
  artistName: string;
  year: number | null;
  trackCount: number;
}

interface AlbumAutocompleteProps {
  /** Selected album id. Null when no album is selected. */
  value: string | null;
  /**
   * Name for `value` when the parent already knows it.
   * Avoids a lookup and keeps the field filled on first paint.
   */
  albumName?: string | null;
  onChange: (albumId: string | null, albumName: string) => void;
  className?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function AlbumAutocomplete({
  value,
  albumName = null,
  onChange,
  className,
  label = "Album",
  placeholder = "Search albums...",
  disabled = false,
}: AlbumAutocompleteProps) {
  const albumId = value || null;
  const knownName = albumName || null;
  const [inputValue, setInputValue] = useState(albumId && knownName ? knownName : "");
  const [isEditing, setIsEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchFetcher = useFetcher<{ albums: Album[] }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const namesById = useRef(new Map<string, string>());
  const editingRef = useRef(false);
  const seenValueRef = useRef(albumId);
  const seenNameRef = useRef(knownName);

  if (albumId && knownName) {
    namesById.current.set(albumId, knownName);
  }

  const albums = searchFetcher.data?.albums ?? [];
  const isSearching = searchFetcher.state !== "idle";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Show the name for the current id, and follow the parent when that id changes.
  // An empty input before the user types must not clear the selected album.
  useEffect(() => {
    const valueChanged = seenValueRef.current !== albumId;
    const nameChanged = seenNameRef.current !== knownName;
    seenValueRef.current = albumId;
    seenNameRef.current = knownName;

    if (editingRef.current && !valueChanged && !nameChanged) {
      return;
    }

    if (valueChanged || nameChanged) {
      editingRef.current = false;
      setIsEditing(false);
      setIsOpen(false);
    }

    if (!albumId) {
      setInputValue("");
      return;
    }

    if (knownName) {
      setInputValue(knownName);
      return;
    }

    const cached = namesById.current.get(albumId);
    if (cached) {
      setInputValue(cached);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/albums/${encodeURIComponent(albumId)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { album: Album | null };
        if (cancelled || !body.album || body.album.id !== albumId) return;
        namesById.current.set(body.album.id, body.album.name);
        if (editingRef.current) return;
        setInputValue(body.album.name);
      } catch (lookupError) {
        if (lookupError instanceof DOMException && lookupError.name === "AbortError") return;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [albumId, knownName]);

  const handleSearch = useCallback(
    (query: string) => {
      if (query.trim().length >= 1) {
        searchFetcher.load(`/api/albums/search?q=${encodeURIComponent(query.trim())}`);
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    },
    [searchFetcher],
  );

  useEffect(() => {
    if (!isEditing) return;

    const debounce = setTimeout(() => {
      if (inputValue.trim()) {
        handleSearch(inputValue);
      } else {
        setIsOpen(false);
      }
    }, 300);

    return () => clearTimeout(debounce);
  }, [inputValue, isEditing, handleSearch]);

  const handleInputChange = (next: string) => {
    editingRef.current = true;
    setIsEditing(true);
    setInputValue(next);
    if (!next.trim() && albumId) {
      onChange(null, "");
    }
  };

  const handleSelect = (album: Album) => {
    namesById.current.set(album.id, album.name);
    editingRef.current = false;
    setIsEditing(false);
    setInputValue(album.name);
    onChange(album.id, album.name);
    setIsOpen(false);
  };

  const showEmpty = isOpen && inputValue.trim().length > 0 && albums.length === 0 && !isSearching;

  return (
    <div className={cn("relative", className)}>
      <Label htmlFor="album-input">{label}</Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id="album-input"
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (inputValue.trim()) {
              handleSearch(inputValue);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Icon name="update" className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {isOpen && (albums.length > 0 || showEmpty) && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => handleSelect(album)}
              className="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-hidden"
            >
              <span className="font-medium">{album.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {album.artistName}
                {album.year != null ? ` · ${album.year}` : ""}
              </span>
            </button>
          ))}

          {showEmpty && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matching albums</p>
          )}
        </div>
      )}
    </div>
  );
}
