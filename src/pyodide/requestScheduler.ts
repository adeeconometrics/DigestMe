interface SchedulerState<T> {
  requestId: number;
  value: T;
  started: boolean;
  cancelled: boolean;
}

export interface ScheduledRequest<T> {
  requestId: number;
  value: T;
}

export interface RequestScheduler<T> {
  enqueue: (request: ScheduledRequest<T>) => void;
  cancel: (requestId: number) => boolean;
}

export function createRequestScheduler<T>(
  maxConcurrent: number,
  execute: (value: T, isCancelled: () => boolean) => Promise<void>,
): RequestScheduler<T> {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("Request scheduler concurrency must be a positive integer.");
  }

  const queue: SchedulerState<T>[] = [];
  const states = new Map<number, SchedulerState<T>>();
  let running = 0;

  function pump(): void {
    while (running < maxConcurrent && queue.length > 0) {
      const state = queue.shift();
      if (!state) break;
      if (state.cancelled) {
        states.delete(state.requestId);
        continue;
      }

      state.started = true;
      running += 1;
      let execution: Promise<void>;
      try {
        execution = execute(state.value, () => state.cancelled);
      } catch (error) {
        execution = Promise.reject(error);
      }
      void execution
        .catch(() => undefined)
        .finally(() => {
          running -= 1;
          states.delete(state.requestId);
          pump();
        });
    }
  }

  return {
    enqueue(request) {
      if (states.has(request.requestId)) {
        throw new Error(`Request ${request.requestId} is already scheduled.`);
      }
      const state: SchedulerState<T> = {
        requestId: request.requestId,
        value: request.value,
        started: false,
        cancelled: false,
      };
      states.set(state.requestId, state);
      queue.push(state);
      pump();
    },
    cancel(requestId) {
      const state = states.get(requestId);
      if (!state) return false;
      state.cancelled = true;
      if (!state.started) {
        const queueIndex = queue.indexOf(state);
        if (queueIndex >= 0) queue.splice(queueIndex, 1);
        states.delete(requestId);
        pump();
      }
      return true;
    },
  };
}
