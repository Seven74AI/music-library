import { useEffect, useState, useRef } from "react";
import { useFetcher } from "react-router";

interface Curator {
  id: string;
  username: string;
  name: string | null;
  displayName: string;
}

interface MentionAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function MentionAutocomplete({ value, onChange, textareaRef }: MentionAutocompleteProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const fetcher = useFetcher<{ curators: Curator[] }>();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const loadedQueryRef = useRef<string | null>(null);

  // Detect @ mentions and trigger autocomplete
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);

    // Find the last @ before cursor
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    // Check if we're in a mention context
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);

      // Only trigger if no spaces after @ and we're right after it
      if (!textAfterAt.includes(" ") && textAfterAt.length >= 0) {
        setMentionQuery(textAfterAt);
        setMentionStart(lastAtIndex);
        setShowDropdown(true);

        // useFetcher's identity changes when a load settles. Skip repeat
        // loads for the same query so a successful response does not refetch.
        if (loadedQueryRef.current !== textAfterAt) {
          loadedQueryRef.current = textAfterAt;
          setSelectedIndex(0);
          // A bare "@" should list curators. Waiting for a letter leaves the menu empty.
          fetcher.load(`/api/curator/curators?q=${encodeURIComponent(textAfterAt)}`);
        }
        return;
      }
    }

    // Hide dropdown if not in mention context
    loadedQueryRef.current = null;
    setShowDropdown(false);
  }, [value, textareaRef, fetcher]);

  const curators = fetcher.data?.curators || [];

  const handleSelectCurator = (curator: Curator) => {
    if (mentionStart === -1) return;

    const beforeMention = value.substring(0, mentionStart);
    const afterMention = value.substring(mentionStart + mentionQuery.length + 1);

    // Insert mention with username
    const newValue = `${beforeMention}@${curator.username} ${afterMention}`;
    onChange(newValue);

    // Set cursor position after the mention
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = mentionStart + curator.username.length + 2;
        textareaRef.current.setSelectionRange(newPos, newPos);
        textareaRef.current.focus();
      }
    }, 0);

    setShowDropdown(false);
    setMentionStart(-1);
    setMentionQuery("");
  };

  // Keyboard navigation
  useEffect(() => {
    if (!showDropdown || curators.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % curators.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + curators.length) % curators.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (curators[selectedIndex]) {
          handleSelectCurator(curators[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDropdown, curators, selectedIndex]);

  // Calculate dropdown position
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!showDropdown || !textareaRef.current || mentionStart === -1) return;

    const textarea = textareaRef.current;
    const textBeforeMention = value.substring(0, mentionStart);

    // Create a temporary div to measure text position
    const mirror = document.createElement("div");
    const computed = window.getComputedStyle(textarea);

    // Copy textarea styles to mirror
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.font = computed.font;
    mirror.style.padding = computed.padding;
    mirror.style.border = computed.border;
    mirror.style.width = computed.width;
    mirror.textContent = textBeforeMention;

    document.body.appendChild(mirror);

    const span = document.createElement("span");
    span.textContent = "@";
    mirror.appendChild(span);

    const spanRect = span.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();

    setDropdownPosition({
      top: spanRect.top - textareaRect.top + textarea.scrollTop + 20,
      left: spanRect.left - textareaRect.left + textarea.scrollLeft,
    });

    document.body.removeChild(mirror);
  }, [showDropdown, mentionStart, value, textareaRef]);

  if (!showDropdown || curators.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="absolute z-50 w-64 rounded-md border border-border bg-popover shadow-lg"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
      }}
    >
      <div className="max-h-48 overflow-y-auto p-1">
        {curators.map((curator, index) => (
          <button
            key={curator.id}
            type="button"
            className={`w-full rounded-sm px-3 py-2 text-left text-sm transition-colors ${
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            }`}
            onClick={() => handleSelectCurator(curator)}
          >
            <div className="font-medium">@{curator.username}</div>
            {curator.name && <div className="text-xs text-muted-foreground">{curator.name}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
