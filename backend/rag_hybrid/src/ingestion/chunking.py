import sys
from dataclasses import replace
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from convert import Document

# all-MiniLM-L6-v2 truncates at 256 tokens. Catalog descriptions fit in one
# chunk, so this is a pass-through for them; it exists for longer sources
# (e.g. student reflections) that need splitting before embedding.
MAX_CHARS = 1500


def chunk_document(doc, max_chars=MAX_CHARS):
    if len(doc.text) <= max_chars:
        return [doc]

    paragraphs = [p.strip() for p in doc.text.split("\n\n") if p.strip()]
    chunks, current = [], ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > max_chars:
            chunks.append(current)
            current = ""
        current = f"{current}\n\n{paragraph}" if current else paragraph
    if current:
        chunks.append(current)

    return [
        replace(doc, doc_key=f"{doc.doc_key}#{i}", text=chunk, metadata={**doc.metadata, "chunk_index": i})
        for i, chunk in enumerate(chunks)
    ]


def chunk_documents(docs, max_chars=MAX_CHARS):
    return [chunk for doc in docs for chunk in chunk_document(doc, max_chars)]
