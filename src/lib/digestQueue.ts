export interface DigestQueueItem {
  id: string;
  position: number;
}

export interface DigestQueue {
  enqueue: (ids: string[]) => DigestQueueItem[];
  finish: (id: string) => string | undefined;
  remove: (id: string) => string | undefined;
}

interface QueueEntry extends DigestQueueItem {
  finished: boolean;
}

/** Keeps multi-document digest jobs in upload order and releases one successor at a time. */
export function createDigestQueue(): DigestQueue {
  const entries: QueueEntry[] = [];
  let nextPosition = 0;

  function releaseReady(): string | undefined {
    if (!entries[0]?.finished) return undefined;
    while (entries[0]?.finished) entries.shift();
    return entries[0]?.id;
  }

  return {
    enqueue(ids) {
      return ids.map((id) => {
        const item: QueueEntry = { id, position: ++nextPosition, finished: false };
        entries.push(item);
        return { id: item.id, position: item.position };
      });
    },
    finish(id) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return undefined;
      entry.finished = true;
      return releaseReady();
    },
    remove(id) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return undefined;
      const wasFirst = index === 0;
      entries.splice(index, 1);
      return wasFirst ? releaseReady() : undefined;
    },
  };
}
