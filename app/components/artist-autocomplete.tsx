import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useFetcher } from "react-router";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Icon } from "#app/components/ui/icon";
import { cn } from "#app/utils/misc";

interface Artist {
  id: string;
  name: string;
  trackCount: number;
}

interface ArtistAutocompleteProps {
  /** Selected artist id. Null when no artist is selected. */
  value: string | null;
  /**
   * Name for `value` when the parent already knows it.
   * Avoids a lookup and keeps the field filled on first paint.
   */
  artistName?: string | null;
  onChange: (artistId: string | null, artistName: string) => void;
  onCreateNew?: (name: string) => Promise<void>;
  error?: string;
  className?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

export function ArtistAutocomplete({
  value,
  artistName = null,
  onChange,
  onCreateNew,
  error,
  className,
  label = "Artist",
  required = false,
  disabled = false,
}: ArtistAutocompleteProps) {
  const artistId = value || null;
  const knownName = artistName || null;
  const [inputValue, setInputValue] = useState(artistId && knownName ? knownName : "");
  const [isEditing, setIsEditing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = `${useId()}-artist-input`;
  const listboxId = `${inputId}-listbox`;
  const searchFetcher = useFetcher<{ artists: Artist[] }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const namesById = useRef(new Map<string, string>());
  const editingRef = useRef(false);
  const seenValueRef = useRef(artistId);
  const seenNameRef = useRef(knownName);

  if (artistId && knownName) {
    namesById.current.set(artistId, knownName);
  }

  const artists = searchFetcher.data?.artists ?? [];
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
  // An empty input before the user types must not clear the selected artist.
  useEffect(() => {
    const valueChanged = seenValueRef.current !== artistId;
    const nameChanged = seenNameRef.current !== knownName;
    seenValueRef.current = artistId;
    seenNameRef.current = knownName;

    if (editingRef.current && !valueChanged && !nameChanged) {
      return;
    }

    if (valueChanged || nameChanged) {
      editingRef.current = false;
      setIsEditing(false);
      setIsOpen(false);
    }

    if (!artistId) {
      setInputValue("");
      return;
    }

    if (knownName) {
      setInputValue(knownName);
      return;
    }

    const cached = namesById.current.get(artistId);
    if (cached) {
      setInputValue(cached);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/artists/${encodeURIComponent(artistId)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { artist: Artist | null };
        if (cancelled || !body.artist || body.artist.id !== artistId) return;
        namesById.current.set(body.artist.id, body.artist.name);
        if (editingRef.current) return;
        setInputValue(body.artist.name);
      } catch (lookupError) {
        if (lookupError instanceof DOMException && lookupError.name === "AbortError") return;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [artistId, knownName]);

  const handleSearch = useCallback(
    (query: string) => {
      if (query.trim().length >= 1) {
        searchFetcher.load(`/api/artists/search?q=${encodeURIComponent(query.trim())}`);
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
    setActiveIndex(-1);
    if (!next.trim() && artistId) {
      onChange(null, "");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((c) => (artists.length === 0 ? -1 : (c + 1) % artists.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIsOpen(true);
      setActiveIndex((c) =>
        artists.length === 0 ? -1 : (c - 1 + artists.length) % artists.length,
      );
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    } else if (e.key === "Enter" && activeIndex >= 0 && artists[activeIndex]) {
      e.preventDefault();
      handleSelect(artists[activeIndex]);
    }
  };

  const handleSelect = (artist: Artist) => {
    namesById.current.set(artist.id, artist.name);
    editingRef.current = false;
    setIsEditing(false);
    setInputValue(artist.name);
    onChange(artist.id, artist.name);
    setIsOpen(false);
  };

  const handleCreateNew = async () => {
    if (!inputValue.trim() || !onCreateNew) return;

    setIsCreating(true);
    try {
      await onCreateNew(inputValue.trim());
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to create artist:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const showCreateOption =
    inputValue.trim().length > 0 && artists.length === 0 && !isSearching && onCreateNew;

  return (
    <div className={cn("relative", className)}>
      <Label htmlFor={inputId}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (inputValue.trim()) {
              handleSearch(inputValue);
            }
          }}
          placeholder="Search or create artist..."
          disabled={disabled || isCreating}
          aria-invalid={error ? true : undefined}
          className={cn(error && "border-input-invalid")}
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Icon name="update" className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {isOpen && !disabled && (artists.length > 0 || showCreateOption) && (
        <div
          ref={dropdownRef}
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {artists.map((artist, index) => (
            <button
              key={artist.id}
              type="button"
              role="option"
              id={`${listboxId}-option-${index}`}
              aria-selected={artist.id === artistId}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => handleSelect(artist)}
              className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-accent focus:bg-accent focus:outline-hidden"
            >
              <span className="font-medium">{artist.name}</span>
              <span className="text-xs text-muted-foreground">
                {artist.trackCount} {artist.trackCount === 1 ? "track" : "tracks"}
              </span>
            </button>
          ))}

          {showCreateOption && (
            <>
              {artists.length > 0 && <div className="my-1 h-px bg-border" />}
              <button
                type="button"
                onClick={handleCreateNew}
                disabled={isCreating}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-hidden disabled:opacity-50"
              >
                <Icon name="plus" className="h-4 w-4" />
                <span>Create new artist &quot;{inputValue.trim()}&quot;</span>
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="min-h-[32px] px-4 pt-1 pb-3">
          <div className="text-[10px] text-destructive">{error}</div>
        </div>
      )}
    </div>
  );
}
