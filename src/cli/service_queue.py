"""Service queue pattern: a fixed pool of workers consuming a shared job queue.

Each job is one case in the input list. A pool of ``worker_count`` threads
pulls jobs from a single ``queue.Queue`` and runs the full case pipeline for
that job, so slow cases never block fast ones and one failing case does not
abort the batch. Results and errors are collected under a lock; jobs finish in
completion order, not input order.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Iterable
from typing import Generic, TypeVar, cast

Job = TypeVar("Job")
Result = TypeVar("Result")

_SENTINEL = object()
"""Queue marker that tells one worker to stop after all real jobs are drained."""


class ServiceQueue(Generic[Job, Result]):
    """Run ``worker`` over every job with a pool of concurrent service workers."""

    def __init__(
        self,
        jobs: Iterable[Job],
        worker: Callable[[Job], Result],
        *,
        worker_count: int = 8,
    ) -> None:
        if worker_count < 1:
            raise ValueError("worker_count must be at least 1")
        self._worker = worker
        self._queue: queue.Queue[Job | object] = queue.Queue()
        for job in jobs:
            self._queue.put(job)
        for _ in range(worker_count):
            self._queue.put(_SENTINEL)
        self._worker_count = worker_count
        self._results: list[tuple[Job, Result]] = []
        self._errors: list[tuple[Job, Exception]] = []
        self._lock = threading.Lock()

    def run(self) -> tuple[list[tuple[Job, Result]], list[tuple[Job, Exception]]]:
        """Start the workers, wait for all jobs, and return ``(results, errors)``.

        A worker exception is recorded against its job instead of propagating,
        so the remaining jobs still complete. The returned lists preserve
        completion order and are safe to read only after ``run`` returns.
        """
        threads = [
            threading.Thread(target=self._serve, name=f"service-worker-{index}", daemon=True)
            for index in range(self._worker_count)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        return self._results, self._errors

    def _serve(self) -> None:
        while True:
            item = self._queue.get()
            try:
                if item is _SENTINEL:
                    return
                job = cast(Job, item)
                try:
                    result = self._worker(job)
                except Exception as error:  # pylint: disable=broad-exception-caught  # isolate one bad job
                    with self._lock:
                        self._errors.append((job, error))
                else:
                    with self._lock:
                        self._results.append((job, result))
            finally:
                self._queue.task_done()
