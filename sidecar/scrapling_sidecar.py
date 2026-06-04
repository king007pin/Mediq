#!/usr/bin/env python3
"""Scrapling HTTP sidecar.

Wraps Scrapling fetchers behind a tiny FastAPI service so the Next.js
crawl routes can request anti-bot-resistant HTML over plain HTTP.

Run:
    ~/scrapling-env/bin/uvicorn sidecar.scrapling_sidecar:app \\
        --host 127.0.0.1 --port 8003

Env:
    SCRAPLING_SIDECAR_PORT   default 8003
    SCRAPLING_SIDECAR_TOKEN  optional shared secret; if set, requests
                             must send `X-Auth-Token: <token>`
"""

from __future__ import annotations

import asyncio
import os
import secrets
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine

try:
    from scrapling.fetchers import Fetcher, StealthyFetcher
except Exception as import_err:  # pragma: no cover
    raise SystemExit(
        f"scrapling import failed: {import_err}\n"
        "Activate the scrapling venv: source ~/scrapling-env/bin/activate"
    )


SHARED_TOKEN = os.environ.get("SCRAPLING_SIDECAR_TOKEN")

app = FastAPI(title="scrapling-sidecar", version="0.1.0")

# Configure Presidio to use the small spaCy model
provider_config = {
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
}
provider = NlpEngineProvider(nlp_configuration=provider_config)
nlp_engine = provider.create_engine()
analyzer = AnalyzerEngine(nlp_engine=nlp_engine)
anonymizer = AnonymizerEngine()

# Custom pattern recognizers for Aadhaar and ABHA
aadhaar_pattern = Pattern(name="aadhaar_pattern", regex=r"\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b", score=0.85)
aadhaar_recognizer = PatternRecognizer(supported_entity="AADHAAR", patterns=[aadhaar_pattern])
analyzer.registry.add_recognizer(aadhaar_recognizer)

abha_pattern = Pattern(name="abha_pattern", regex=r"\b\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b", score=0.85)
abha_recognizer = PatternRecognizer(supported_entity="ABHA", patterns=[abha_pattern])
analyzer.registry.add_recognizer(abha_recognizer)


class ScrapeRequest(BaseModel):
    url: str
    mode: str = Field("auto", pattern="^(auto|fetch|stealthy)$")
    timeout_ms: int = 30_000
    wait_selector: Optional[str] = None
    user_agent: Optional[str] = None


class ScrapeResponse(BaseModel):
    ok: bool
    status: int
    final_url: str
    html: str
    content_type: Optional[str] = None
    used_mode: Optional[str] = None
    error: Optional[str] = None


class DeidentifyRequest(BaseModel):
    text: str = Field(..., max_length=50000)
    language: str = "en"


class DeidentifyResponse(BaseModel):
    ok: bool
    text: str
    error: Optional[str] = None


def _body_to_text(page) -> str:
    body = getattr(page, "body", None)
    if body is None:
        body = getattr(page, "content", b"") or b""
    if isinstance(body, bytes):
        return body.decode("utf-8", errors="ignore")
    return str(body)


def _headers_get(page, key: str) -> Optional[str]:
    headers = getattr(page, "headers", None)
    if not headers:
        return None
    try:
        return headers.get(key)
    except AttributeError:
        return dict(headers).get(key)


def _do_fetch(url: str, timeout_s: float, ua: Optional[str]):
    kwargs = {
        "timeout": timeout_s,
        "follow_redirects": True,
        "stealthy_headers": True,
    }
    if ua:
        kwargs["headers"] = {"User-Agent": ua}
    return Fetcher.get(url, **kwargs)


def _do_stealthy(url: str, timeout_ms: int, wait_selector: Optional[str]):
    kwargs = {
        "headless": True,
        "humanize": True,
        "network_idle": True,
        "timeout": timeout_ms,
    }
    if wait_selector:
        kwargs["wait_selector"] = wait_selector
    return StealthyFetcher.fetch(url, **kwargs)


@app.get("/health")
def health():
    return {"ok": True, "service": "scrapling-sidecar", "version": app.version}


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape(
    req: ScrapeRequest,
    x_auth_token: Optional[str] = Header(default=None, alias="X-Auth-Token"),
):
    if SHARED_TOKEN and (not x_auth_token or not secrets.compare_digest(x_auth_token, SHARED_TOKEN)):
        raise HTTPException(status_code=401, detail="bad token")

    timeout_s = max(1.0, req.timeout_ms / 1000.0)

    # 1. Try fast HTTP fetch first when mode allows it.
    if req.mode in ("auto", "fetch"):
        try:
            page = await asyncio.to_thread(_do_fetch, req.url, timeout_s, req.user_agent)
            status = int(getattr(page, "status", 0) or 0)
            html = _body_to_text(page)
            if status and status < 400 and len(html) > 200:
                return ScrapeResponse(
                    ok=True,
                    status=status,
                    final_url=str(getattr(page, "url", req.url)),
                    html=html,
                    content_type=_headers_get(page, "content-type"),
                    used_mode="fetch",
                )
            if req.mode == "fetch":
                return ScrapeResponse(
                    ok=False,
                    status=status,
                    final_url=str(getattr(page, "url", req.url)),
                    html=html,
                    used_mode="fetch",
                    error=f"HTTP {status} or empty body",
                )
        except Exception as e:
            if req.mode == "fetch":
                return ScrapeResponse(
                    ok=False, status=0, final_url=req.url, html="",
                    used_mode="fetch", error=str(e),
                )

    # 2. Stealthy headless-browser fetch as fallback / explicit mode.
    try:
        page = await asyncio.to_thread(_do_stealthy, req.url, req.timeout_ms, req.wait_selector)
        status = int(getattr(page, "status", 200) or 200)
        html = _body_to_text(page)
        return ScrapeResponse(
            ok=status < 400 and len(html) > 0,
            status=status,
            final_url=str(getattr(page, "url", req.url)),
            html=html,
            content_type=_headers_get(page, "content-type"),
            used_mode="stealthy",
        )
    except Exception as e:
        return ScrapeResponse(
            ok=False, status=0, final_url=req.url, html="",
            used_mode="stealthy", error=str(e),
        )


@app.post("/deidentify", response_model=DeidentifyResponse)
def deidentify(
    req: DeidentifyRequest,
    x_auth_token: Optional[str] = Header(default=None, alias="X-Auth-Token"),
):
    if SHARED_TOKEN and (not x_auth_token or not secrets.compare_digest(x_auth_token, SHARED_TOKEN)):
        raise HTTPException(status_code=401, detail="bad token")

    if not req.text.strip():
        return DeidentifyResponse(ok=True, text="")

    try:
        results = analyzer.analyze(text=req.text, language=req.language)
        anonymized_result = anonymizer.anonymize(text=req.text, analyzer_results=results)
        return DeidentifyResponse(ok=True, text=anonymized_result.text)
    except Exception as e:
        return DeidentifyResponse(ok=False, text=req.text, error=str(e))
