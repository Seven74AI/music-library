import { useState, useRef, useEffect } from "react";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { cn } from "#app/utils/misc.tsx";

interface EditableTextProps {
  value: string;
  onSave: (newValue: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  maxLength?: number;
  disabled?: boolean;
}

export function EditableText({
  value,
  onSave,
  placeholder = "Enter text...",
  className,
  multiline = false,
  maxLength,
  disabled = false,
}: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== value) {
      onSave(trimmedValue);
    }
    setIsEditing(false);
    setEditValue(value); // Reset to original value
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(value); // Reset to original value
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleClick = () => {
    if (!disabled) {
      setIsEditing(true);
    }
  };

  if (isEditing) {
    const editClass = cn(
      "w-full bg-transparent border-none outline-none resize-none",
      "text-inherit font-inherit",
      multiline ? "min-h-[60px]" : "h-auto",
    );
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      if (!maxLength || newValue.length <= maxLength) {
        setEditValue(newValue);
      }
    };

    return (
      <div className={cn("relative", className)}>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={editValue}
            onChange={handleChange}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            className={editClass}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={editValue}
            onChange={handleChange}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={editClass}
          />
        )}
        <div className="absolute top-1 right-1 flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSave}>
            <Icon name="check" className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCancel}>
            <Icon name="x-mark" className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 -my-1 transition-all duration-200 ease-out",
        disabled && "cursor-default hover:bg-transparent",
        className,
      )}
      onClick={handleClick}
    >
      {value || <span className="text-muted-foreground italic">{placeholder}</span>}
      {!disabled && (
        <Icon
          name="pencil-1"
          className="h-3 w-3 ml-2 inline opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out"
        />
      )}
    </div>
  );
}
