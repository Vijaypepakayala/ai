"""Telnyx API client using httpx."""

from __future__ import annotations

import asyncio
from typing import Any, Callable

import httpx


class TelnyxAPIError(Exception):
    """Error from the Telnyx API."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        errors: list[dict[str, Any]] | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        self.status_code = status_code
        self.detail = detail
        self.errors = errors or []
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"Telnyx API error {status_code}: {detail}")


class TelnyxAPIClient:
    """Async-first HTTP client for the Telnyx API v2.

    Uses httpx.AsyncClient under the hood. Provides both async and sync methods.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://api.telnyx.com/v2",
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._async_client: httpx.AsyncClient | None = None

    @property
    def api_key(self) -> str:
        return self._api_key

    def _get_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _build_headers(
        self,
        *,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, str]:
        built = self._get_headers()
        if idempotency_key:
            built["Idempotency-Key"] = idempotency_key
        if headers:
            built.update(headers)
        return built

    async def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is None or self._async_client.is_closed:
            self._async_client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._get_headers(),
                timeout=self._timeout,
            )
        return self._async_client

    async def _handle_response(self, response: httpx.Response) -> tuple[dict[str, Any], float | None]:
        retry_after_seconds = _parse_retry_after_seconds(response.headers.get("retry-after"))
        if response.status_code >= 400:
            try:
                body = response.json()
                errors = body.get("errors", [])
                detail = errors[0].get("detail", response.text) if errors else response.text
            except Exception:
                detail = response.text
                errors = []
            raise TelnyxAPIError(
                status_code=response.status_code,
                detail=detail,
                errors=errors,
                retry_after_seconds=retry_after_seconds,
            )
        if response.status_code == 204:
            return {}, retry_after_seconds
        return response.json(), retry_after_seconds  # type: ignore[no-any-return]

    async def get_async(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Async GET request."""
        client = await self._get_async_client()
        response = await client.get(path, params=params, headers=self._build_headers(headers=headers))
        body, _ = await self._handle_response(response)
        return body

    async def post_async(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Async POST request."""
        client = await self._get_async_client()
        response = await client.post(
            path,
            json=json,
            headers=self._build_headers(headers=headers, idempotency_key=idempotency_key),
        )
        body, _ = await self._handle_response(response)
        return body

    async def delete_async(
        self,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Async DELETE request."""
        client = await self._get_async_client()
        response = await client.delete(
            path,
            headers=self._build_headers(headers=headers, idempotency_key=idempotency_key),
        )
        body, _ = await self._handle_response(response)
        return body

    async def put_async(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Async PUT request."""
        client = await self._get_async_client()
        response = await client.put(
            path,
            json=json,
            headers=self._build_headers(headers=headers, idempotency_key=idempotency_key),
        )
        body, _ = await self._handle_response(response)
        return body

    async def patch_async(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Async PATCH request."""
        client = await self._get_async_client()
        response = await client.patch(
            path,
            json=json,
            headers=self._build_headers(headers=headers, idempotency_key=idempotency_key),
        )
        body, _ = await self._handle_response(response)
        return body

    async def poll_async(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        interval_seconds: float = 1.0,
        timeout_seconds: float | None = None,
        is_done: Callable[[dict[str, Any]], bool] | None = None,
    ) -> dict[str, Any]:
        """Poll a GET endpoint until it reaches a terminal state."""
        deadline = asyncio.get_running_loop().time() + (timeout_seconds or self._timeout)
        poll_done = is_done or _default_is_done

        while True:
            client = await self._get_async_client()
            response = await client.get(path, params=params, headers=self._build_headers(headers=headers))
            body, retry_after_seconds = await self._handle_response(response)

            if poll_done(body):
                return body

            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise TimeoutError(f"Timed out polling {path} after {timeout_seconds or self._timeout} seconds")

            delay = min(retry_after_seconds or interval_seconds, remaining)
            await asyncio.sleep(max(0.0, delay))

    def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Sync GET request (convenience wrapper)."""
        return _run_sync(self.get_async(path, params=params, headers=headers))

    def post(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Sync POST request (convenience wrapper)."""
        return _run_sync(self.post_async(path, json=json, headers=headers, idempotency_key=idempotency_key))

    def delete(
        self,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Sync DELETE request (convenience wrapper)."""
        return _run_sync(self.delete_async(path, headers=headers, idempotency_key=idempotency_key))

    def put(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Sync PUT request (convenience wrapper)."""
        return _run_sync(self.put_async(path, json=json, headers=headers, idempotency_key=idempotency_key))

    def patch(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Sync PATCH request (convenience wrapper)."""
        return _run_sync(self.patch_async(path, json=json, headers=headers, idempotency_key=idempotency_key))

    def poll(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        interval_seconds: float = 1.0,
        timeout_seconds: float | None = None,
        is_done: Callable[[dict[str, Any]], bool] | None = None,
    ) -> dict[str, Any]:
        """Sync polling convenience wrapper."""
        return _run_sync(
            self.poll_async(
                path,
                params=params,
                headers=headers,
                interval_seconds=interval_seconds,
                timeout_seconds=timeout_seconds,
                is_done=is_done,
            )
        )

    async def close(self) -> None:
        """Close the async client."""
        if self._async_client and not self._async_client.is_closed:
            await self._async_client.aclose()


def _run_sync(coro: Any) -> Any:
    """Run an async coroutine synchronously.

    Uses a persistent event loop in a background thread to avoid
    the 'Event loop is closed' issue from repeated asyncio.run() calls.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Already in an async context — create a new thread
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        loop = _get_sync_loop()
        return asyncio.run_coroutine_threadsafe(coro, loop).result()


_sync_loop: asyncio.AbstractEventLoop | None = None
_sync_thread: Any = None


def _get_sync_loop() -> asyncio.AbstractEventLoop:
    """Get or create a persistent background event loop for sync calls."""
    global _sync_loop, _sync_thread
    if _sync_loop is None or _sync_loop.is_closed():
        import threading

        _sync_loop = asyncio.new_event_loop()

        def _run_loop(loop: asyncio.AbstractEventLoop) -> None:
            asyncio.set_event_loop(loop)
            loop.run_forever()

        _sync_thread = threading.Thread(target=_run_loop, args=(_sync_loop,), daemon=True)
        _sync_thread.start()
    return _sync_loop


def _parse_retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None

    try:
        parsed = float(value)
    except ValueError:
        return None

    return parsed if parsed >= 0 else None


def _default_is_done(response: dict[str, Any]) -> bool:
    data = response.get("data")
    if isinstance(data, dict):
        status = data.get("status") or data.get("operation_status")
    else:
        status = response.get("status")

    if not isinstance(status, str) or not status:
        return True

    return status.lower() in {"completed", "failed", "canceled", "cancelled", "error", "succeeded"}
