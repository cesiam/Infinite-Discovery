"""One-off: make a small request to the catalog API and print the response SHAPE
(keys, types, a truncated sample) so the client is written against real field
names. Tries a few auth styles and reports which one the gateway accepts.
Never prints credentials; any echo of them in a response is redacted.

usage: python scripts/explore_catalog_api.py [path] [key=value ...]
"""
import json
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from config import CATALOG_BASE_URL, CATALOG_CLIENT_ID, CATALOG_CLIENT_SECRET


def redact(text):
    for secret in (CATALOG_CLIENT_ID, CATALOG_CLIENT_SECRET):
        if secret:
            text = text.replace(secret, "<redacted>")
    return text


def shape(value, depth=0, max_depth=4):
    if depth >= max_depth:
        return "..."
    if isinstance(value, dict):
        return {k: shape(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [f"list[{len(value)}]", shape(value[0], depth + 1)] if value else "list[0]"
    if isinstance(value, str):
        return f"str: {value[:60]!r}"
    return f"{type(value).__name__}: {value!r}"


def main():
    if not (CATALOG_CLIENT_ID and CATALOG_CLIENT_SECRET):
        sys.exit("Set MIT_CATALOG_CLIENT_ID and MIT_CATALOG_CLIENT_SECRET in .env first.")

    path = sys.argv[1] if len(sys.argv) > 1 else ""
    params = dict(arg.split("=", 1) for arg in sys.argv[2:])
    url = urljoin(CATALOG_BASE_URL, path)
    attempts = {
        "no auth": {},
        "client_id/client_secret headers": {"headers": {"client_id": CATALOG_CLIENT_ID,
                                                        "client_secret": CATALOG_CLIENT_SECRET}},
        "HTTP basic": {"auth": (CATALOG_CLIENT_ID, CATALOG_CLIENT_SECRET)},
    }
    print(f"GET {url} params={params}")
    for name, kwargs in attempts.items():
        resp = requests.get(url, params=params, timeout=30, **kwargs)
        print(f"\n=== {name}: HTTP {resp.status_code} ({resp.headers.get('Content-Type')})")
        interesting = {k: v for k, v in resp.headers.items()
                       if k.lower().startswith(("x-ratelimit", "ratelimit", "retry-after", "link", "www-authenticate"))}
        if interesting:
            print("headers:", interesting)
        try:
            print(redact(json.dumps(shape(resp.json()), indent=2)[:4000]))
        except ValueError:
            print(redact(resp.text[:1000]))


if __name__ == "__main__":
    main()
