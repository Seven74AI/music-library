import * as React from "react";

import { type ToastActionElement, type ToastProps } from "#app/components/ui/toast.tsx";

const TOAST_LIMIT = 1;
// Long enough for the close animation. A million-millisecond delay left a
// dismissed toast mounted, so the next toast never took its place.
const TOAST_REMOVE_DELAY = 1000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | {
      type: ActionType["ADD_TOAST"];
      toast: ToasterToast;
    }
  | {
      type: ActionType["UPDATE_TOAST"];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType["DISMISS_TOAST"];
      toastId?: ToasterToast["id"];
    }
  | {
      type: ActionType["REMOVE_TOAST"];
      toastId?: ToasterToast["id"];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const closeArmed = new Set<string>();
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

const clearToastTimeout = (toastId: string) => {
  const timeout = toastTimeouts.get(toastId);
  if (!timeout) return;
  clearTimeout(timeout);
  toastTimeouts.delete(toastId);
};

const clearAllToastTimeouts = () => {
  for (const timeout of toastTimeouts.values()) clearTimeout(timeout);
  toastTimeouts.clear();
  for (const timeout of pendingTimeouts) clearTimeout(timeout);
  pendingTimeouts.clear();
  closeArmed.clear();
};

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const armClose = (toastId: string) => {
  const timeout = setTimeout(() => {
    pendingTimeouts.delete(timeout);
    closeArmed.add(toastId);
  }, 0);
  pendingTimeouts.add(timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST": {
      const nextToasts = [
        action.toast,
        ...state.toasts.filter((t) => t.id !== action.toast.id),
      ].slice(0, TOAST_LIMIT);
      for (const existing of state.toasts) {
        if (!nextToasts.some((t) => t.id === existing.id)) {
          clearToastTimeout(existing.id);
          closeArmed.delete(existing.id);
        }
      }
      return {
        ...state,
        toasts: nextToasts,
      };
    }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((t) => {
          addToRemoveQueue(t.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, "id"> & { id?: string };

function toast({ id: idProp, ...props }: Toast) {
  const id = idProp ?? genId();

  const update = (updateProps: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...updateProps, id },
    });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });

  armClose(id);

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        // Ignore the close Radix emits while the previous toast is swapped out.
        // Dismissing here would flash the new toast away and leave the old one up.
        if (!open && closeArmed.has(id)) dismiss();
      },
    },
  });

  return {
    id: id,
    dismiss,
    update,
  };
}

function resetToastsForTests() {
  clearAllToastTimeouts();
  dispatch({ type: "REMOVE_TOAST" });
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useLayoutEffect(() => {
    listeners.push(setState);
    setState(memoryState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

export { useToast, toast, resetToastsForTests };
