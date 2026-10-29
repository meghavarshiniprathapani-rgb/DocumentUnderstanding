"""Retriever interfaces and FAISS-backed dense index implementation."""

from abc import ABC, abstractmethod
from typing import List, Optional

import faiss
import numpy as np

from backend.retrieval.embedding import BaseEmbedding, DenseDeterministicEmbedding
from backend.retrieval.schema import Chunk, RetrievalResult


class BaseRetriever(ABC):
    """Abstract interface for document retrievers."""

    @abstractmethod
    def index(self, chunks: List[Chunk]) -> None:
        """Index a collection of chunks."""
        pass

    @abstractmethod
    def retrieve(self, query: str, top_k: int = 5) -> List[RetrievalResult]:
        """Retrieve top_k chunks relevant to the query."""
        pass


class FaissRetriever(BaseRetriever):
    """High-performance dense retriever powered by FAISS and L2-normalized vector embeddings."""

    def __init__(
        self,
        embedding_model: Optional[BaseEmbedding] = None,
        use_confidence_weighting: bool = False,
    ) -> None:
        self.embedding = embedding_model or DenseDeterministicEmbedding(dimension=128)
        self.use_confidence_weighting = use_confidence_weighting
        self.index_faiss: Optional[faiss.IndexFlatIP] = None
        self.chunks: List[Chunk] = []

    def index(self, chunks: List[Chunk]) -> None:
        """Build FAISS inner-product index over normalized chunk embeddings."""
        self.chunks = list(chunks)
        if not self.chunks:
            self.index_faiss = faiss.IndexFlatIP(self.embedding.dimension)
            return

        texts = [c.text for c in self.chunks]
        embeddings = self.embedding.embed_texts(texts)

        # Ensure float32 contiguous array
        embeddings = np.ascontiguousarray(embeddings, dtype=np.float32)

        self.index_faiss = faiss.IndexFlatIP(self.embedding.dimension)
        self.index_faiss.add(embeddings)

    def retrieve(self, query: str, top_k: int = 5) -> List[RetrievalResult]:
        """Search FAISS index and return ranked RetrievalResult instances."""
        if not self.chunks or self.index_faiss is None or self.index_faiss.ntotal == 0:
            return []

        k = min(top_k, len(self.chunks))
        query_vec = self.embedding.embed_query(query)
        query_vec = np.ascontiguousarray(query_vec, dtype=np.float32)

        raw_scores, indices = self.index_faiss.search(query_vec, k)
        raw_scores = raw_scores[0]
        indices = indices[0]

        results: List[RetrievalResult] = []
        for rank_idx, (chunk_idx, score) in enumerate(zip(indices, raw_scores)):
            if chunk_idx < 0 or chunk_idx >= len(self.chunks):
                continue

            chunk = self.chunks[chunk_idx]
            final_score = float(score)

            # Optional O3 confidence gating: if chunk confidence is known, softly penalize degraded extractions
            if self.use_confidence_weighting:
                conf = chunk.calibrated_confidence if chunk.calibrated_confidence is not None else chunk.raw_confidence
                if chunk.is_degraded:
                    conf = min(conf, 0.40)
                final_score = 0.70 * final_score + 0.30 * conf

            results.append(
                RetrievalResult(
                    chunk=chunk,
                    score=round(final_score, 4),
                    rank=rank_idx + 1,
                )
            )

        # Sort by final score if confidence weighting was applied
        if self.use_confidence_weighting:
            results.sort(key=lambda r: r.score, reverse=True)
            for i, r in enumerate(results):
                r.rank = i + 1

        return results

