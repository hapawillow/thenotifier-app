// Simple event emitter for calendar check events
type CalendarCheckListener = (changedEvents: import('./calendar-check').ChangedCalendarEvent[]) => void;

class CalendarCheckEventEmitter {
  private listeners: Set<CalendarCheckListener> = new Set();

  subscribe(listener: CalendarCheckListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(changedEvents: import('./calendar-check').ChangedCalendarEvent[]): void {
    this.listeners.forEach(listener => listener(changedEvents));
  }
}

export const calendarCheckEvents = new CalendarCheckEventEmitter();

