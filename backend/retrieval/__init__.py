"""Downstream retrieval and chunking evaluation package for Retrieva AI."""

from backend.retrieval.bm25 import BM25Index, bm25_tokenize
from backend.retrieval.chunking import BaseChunker, NaiveFlatChunker, StructuredElementChunker
from backend.retrieval.embedding import BaseEmbedding, DenseDeterministicEmbedding
from backend.retrieval.retriever import BaseRetriever, FaissRetriever
from backend.retrieval.schema import Chunk, RetrievalResult

__all__ = [
    "BaseChunker",
    "NaiveFlatChunker",
    "StructuredElementChunker",
    "BaseEmbedding",
    "DenseDeterministicEmbedding",
    "BaseRetriever",
    "FaissRetriever",
    "BM25Index",
    "bm25_tokenize",
    "Chunk",
    "RetrievalResult",
]

