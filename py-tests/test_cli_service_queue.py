"""Tests for the headless service queue worker pool."""

from __future__ import annotations

import threading
import time

import pytest

from cli.service_queue import ServiceQueue


def test_processes_all_jobs_with_default_eight_workers() -> None:
    jobs = list(range(20))
    results, errors = ServiceQueue(jobs, lambda job: job * 2).run()
    assert not errors
    assert sorted(result for _, result in results) == [job * 2 for job in jobs]


def test_worker_exceptions_are_isolated_per_job() -> None:
    jobs = list(range(6))

    def worker(job: int) -> int:
        if job == 3:
            raise ValueError("boom")
        return job

    results, errors = ServiceQueue(jobs, worker).run()
    assert [job for job, _ in results] == [0, 1, 2, 4, 5]
    assert [job for job, _ in errors] == [3]
    assert isinstance(errors[0][1], ValueError)


def test_concurrency_is_capped_at_worker_count() -> None:
    active = 0
    peak = 0
    lock = threading.Lock()

    def worker(job: int) -> int:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.02)
        with lock:
            active -= 1
        return job

    results, errors = ServiceQueue(range(12), worker, worker_count=4).run()
    assert not errors
    assert len(results) == 12
    assert peak == 4


def test_empty_job_list_completes_immediately() -> None:
    service: ServiceQueue[int, int] = ServiceQueue([], lambda job: job)
    results: list[tuple[int, int]]
    errors: list[tuple[int, Exception]]
    results, errors = service.run()
    assert not results
    assert not errors


def test_rejects_zero_workers() -> None:
    with pytest.raises(ValueError, match="worker_count"):
        ServiceQueue([1], lambda job: job, worker_count=0)
