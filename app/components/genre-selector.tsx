import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Icon } from "#app/components/ui/icon";
import { Badge } from "#app/components/ui/badge";
import { Button } from "#app/components/ui/button";
import { Checkbox } from "#app/components/ui/checkbox";
import { cn } from "#app/utils/misc";

export interface Genre {
  id: string;
  name: string;
  trackCount: number;
}

interface GenreSelectorProps {
  selectedGenres: Genre[];
  onChange: (genres: Genre[]) => void;
  onCreateNew?: (name: string) => Promise<Genre>;
  error?: string;
  className?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  maxGenres?: number;
}

export function GenreSelector({
  selectedGenres,
  onChange,
  onCreateNew,
  error,
  className,
  label = "Genres",
  required = false,
  disabled = false,
  maxGenres,
}: GenreSelectorProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const genresFetcher = useFetcher<{ genres: Genre[] }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allGenres = genresFetcher.data?.genres ?? [];
  const isLoading = genresFetcher.state !== "idle";

  // Load all genres on mount (only once)
  useEffect(() => {
    if (genresFetcher.state === "idle" && !genresFetcher.data) {
      genresFetcher.load("/api/genres");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps array - only load once on mount

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setInputValue("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter genres by input value
  const filteredGenres = allGenres.filter((genre) => {
    // Don't show already selected genres
    if (selectedGenres.some((g) => g.id === genre.id)) {
      return false;
    }
    // Filter by search query
    if (inputValue.trim()) {
      return genre.name.toLowerCase().includes(inputValue.toLowerCase());
    }
    return true;
  });

  const handleToggleGenre = (genre: Genre) => {
    const isSelected = selectedGenres.some((g) => g.id === genre.id);

    if (isSelected) {
      // Remove genre
      onChange(selectedGenres.filter((g) => g.id !== genre.id));
    } else {
      // Add genre (check max limit)
      if (maxGenres && selectedGenres.length >= maxGenres) {
        return;
      }
      onChange([...selectedGenres, genre]);
    }
    setInputValue("");
  };

  const handleRemoveGenre = (genreId: string) => {
    onChange(selectedGenres.filter((g) => g.id !== genreId));
  };

  const handleCreateNew = async () => {
    if (!inputValue.trim() || !onCreateNew) return;

    // Check if genre already exists (case-insensitive)
    const existingGenre = allGenres.find(
      (g) => g.name.toLowerCase() === inputValue.trim().toLowerCase(),
    );

    if (existingGenre) {
      // Just select it
      handleToggleGenre(existingGenre);
      setInputValue("");
      return;
    }

    // Check max limit
    if (maxGenres && selectedGenres.length >= maxGenres) {
      return;
    }

    setIsCreating(true);
    try {
      const newGenre = await onCreateNew(inputValue.trim());
      onChange([...selectedGenres, newGenre]);
      setIsOpen(false);
      setInputValue("");
      // Reload genres list
      genresFetcher.load("/api/genres");
    } catch (err) {
      console.error("Failed to create genre:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      if (filteredGenres.length === 1 && filteredGenres[0]) {
        // If only one match, select it
        handleToggleGenre(filteredGenres[0]);
      } else if (onCreateNew && filteredGenres.length === 0) {
        // If no matches and create is enabled, create new
        void handleCreateNew();
      }
    } else if (e.key === "Backspace" && !inputValue && selectedGenres.length > 0) {
      // Remove last genre when backspace on empty input
      onChange(selectedGenres.slice(0, -1));
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor="genre-selector">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}

      {/* Selected Genres as Tags */}
      {selectedGenres.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedGenres.map((genre) => (
            <Badge key={genre.id} variant="secondary" className="pl-3 pr-1 py-1">
              {genre.name}
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 ml-2 hover:bg-transparent"
                  onClick={() => handleRemoveGenre(genre.id)}
                >
                  <Icon name="cross-1" className="h-3 w-3" />
                </Button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Input Field */}
      <div className="relative">
        <Input
          id="genre-selector"
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedGenres.length > 0 ? "Add more genres..." : "Search or create genres..."
          }
          disabled={disabled || (maxGenres !== undefined && selectedGenres.length >= maxGenres)}
          className={cn(error && "border-destructive")}
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Icon name="update" className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg"
          style={{ width: inputRef.current?.offsetWidth }}
        >
          {filteredGenres.length === 0 ? (
            <div className="p-3">
              {inputValue.trim() ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">No genres match "{inputValue}"</p>
                  {onCreateNew && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={handleCreateNew}
                      disabled={isCreating}
                    >
                      {isCreating ? (
                        <>
                          <Icon name="update" className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Icon name="plus" className="mr-2 h-4 w-4" />
                          Create "{inputValue}"
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {selectedGenres.length > 0 ? "All genres selected" : "No genres available"}
                </p>
              )}
            </div>
          ) : (
            <div className="p-1">
              {filteredGenres.map((genre) => (
                <button
                  key={genre.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleToggleGenre(genre)}
                >
                  <Checkbox
                    checked={selectedGenres.some((g) => g.id === genre.id)}
                    className="pointer-events-none"
                  />
                  <span className="flex-1 text-left">{genre.name}</span>
                  <span className="text-xs text-muted-foreground">{genre.trackCount} tracks</span>
                </button>
              ))}
              {onCreateNew && inputValue.trim() && (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-t mt-1 pt-2"
                  onClick={handleCreateNew}
                  disabled={isCreating}
                >
                  <Icon name="plus" className="h-4 w-4" />
                  <span>Create "{inputValue}"</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {maxGenres && (
        <p className="text-xs text-muted-foreground">
          {selectedGenres.length} / {maxGenres} genres selected
        </p>
      )}
    </div>
  );
}
