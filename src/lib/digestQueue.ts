export interface DigestQueueItem {
  id: string;
  position: number;
}

export interface DigestQueue {
  enqueue: (ids: string[]) => DigestQueueItem[];
  finish: (id: string) => string | undefined;
  remove: (id: string) => string | undefined;
}

/** Keeps multi-document digest jobs in upload order and releases one successor at a time. */
export function createDigestQueue(): DigestQueue {
  const entries: DigestQueueItem[] = [];
  let nextPosition = 0;

  return {
    enqueue(ids) {
      return ids.map((id) => {
        const item = { id, position: ++nextPosition };
        entries.push(item);
        return item;
      });
    },
    finish(id) {
      if (entries[0]?.id !== id) return undefined;
      entries.shift();
      return entries[0]?.id;
    },
    remove(id) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return undefined;
      const wasFirst = index === 0;
      entries.splice(index, 1);
      return wasFirst ? entries[0]?.id : undefined;
    },
  };
}
