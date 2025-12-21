// Simple event emitter for notification data refresh events
type NotificationRefreshListener = () => void;

class NotificationRefreshEventEmitter {
  private listeners: Set<NotificationRefreshListener> = new Set();

  subscribe(listener: NotificationRefreshListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const notificationRefreshEvents = new NotificationRefreshEventEmitter();

