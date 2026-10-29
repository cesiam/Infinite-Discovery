import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from config import EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL

# Loaded on first use, not at import: importing search.py for a unit test
# shouldn't pull a model off the network.
_embedding_model = None


def _model():
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        _embedding_model = TextEmbedding(model_name=EMBEDDING_MODEL)
    return _embedding_model


def generate_embedding(text):
    return generate_embeddings([text])[0]


def generate_embeddings(texts):
    embeddings = _model().embed(list(texts), batch_size=EMBEDDING_BATCH_SIZE)
    return [embedding.tolist() for embedding in embeddings]


if __name__ == "__main__":
    sample_texts = ["Introduction to machine learning", "Linear algebra"]
    for text, embedding in zip(sample_texts, generate_embeddings(sample_texts)):
        print(f"{text!r}: {embedding[:5]}... (length: {len(embedding)})")
