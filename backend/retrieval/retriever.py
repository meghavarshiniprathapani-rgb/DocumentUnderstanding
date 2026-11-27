"""Retriever interfaces and FAISS-backed dense index implementation."""

import threading
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
    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        document_ids: Optional[List[str]] = None,
    ) -> List[RetrievalResult]:
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
        self._lock = threading.RLock()
        self.index_faiss: Optional[faiss.IndexFlatIP] = None
        self.chunks: List[Chunk] = []

    def index(self, chunks: List[Chunk]) -> None:
        """Build FAISS inner-product index over normalized chunk embeddings."""
        next_chunks = list(chunks)
        if not next_chunks:
            empty_index = faiss.IndexFlatIP(self.embedding.dimension)
            with self._lock:
                self.chunks = []
                self.index_faiss = empty_index
            return

        texts = [c.text for c in next_chunks]
        embeddings = self.embedding.embed_texts(texts)
        embeddings = np.ascontiguousarray(embeddings, dtype=np.float32)

        next_index = faiss.IndexFlatIP(self.embedding.dimension)
        next_index.add(embeddings)

        with self._lock:
            self.chunks = next_chunks
            self.index_faiss = next_index

    def remove_document(self, document_id: str) -> None:
        """Remove all chunks associated with a document and rebuild the index."""
        with self._lock:
            remaining = [c for c in self.chunks if c.source_doc_id != document_id]
            self.index(remaining)

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        document_ids: Optional[List[str]] = None,
    ) -> List[RetrievalResult]:
        """Search FAISS index and return ranked RetrievalResult instances."""
        with self._lock:
            chunks_snapshot = list(self.chunks)
            index_snapshot = self.index_faiss
            if not chunks_snapshot or index_snapshot is None or index_snapshot.ntotal == 0:
                return []

            doc_filter = None
            if document_ids:
                doc_filter = {d for d in document_ids if d and d.lower() != "all"}
                if not doc_filter:
                    doc_filter = None

            search_k = (
                min(len(chunks_snapshot), max(top_k * 4, 25))
                if doc_filter
                else min(top_k, len(chunks_snapshot))
            )
            query_vec = self.embedding.embed_query(query)
            query_vec = np.ascontiguousarray(query_vec, dtype=np.float32)

            raw_scores, indices = index_snapshot.search(query_vec, search_k)
            raw_scores = raw_scores[0]
            indices = indices[0]

            results: List[RetrievalResult] = []
            for rank_idx, (chunk_idx, score) in enumerate(zip(indices, raw_scores)):
                if chunk_idx < 0 or chunk_idx >= len(chunks_snapshot):
                    continue

                chunk = chunks_snapshot[chunk_idx]
                if doc_filter and chunk.source_doc_id not in doc_filter:
                    continue

                final_score = float(score)

                if self.use_confidence_weighting:
                    conf = chunk.calibrated_confidence if chunk.calibrated_confidence is not None else chunk.raw_confidence
                    if chunk.is_degraded:
                        conf = min(conf, 0.40)
                    final_score = 0.70 * final_score + 0.30 * conf

                results.append(
                    RetrievalResult(
                        chunk=chunk,
                        score=round(final_score, 4),
                        rank=len(results) + 1,
                    )
                )

                if len(results) >= top_k:
                    break

            if self.use_confidence_weighting:
                results.sort(key=lambda r: r.score, reverse=True)
                for i, r in enumerate(results):
                    r.rank = i + 1

            return results
