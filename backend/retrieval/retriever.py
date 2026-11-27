"""Retriever interfaces and FAISS-backed dense index implementation."""

import threading
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Set, Tuple

import faiss
import numpy as np

from backend.retrieval.bm25 import BM25Index, bm25_tokenize
from backend.retrieval.embedding import BaseEmbedding, DenseDeterministicEmbedding
from backend.retrieval.schema import Chunk, RetrievalResult

STOP_WORDS = frozenset(
    {
        "what",
        "which",
        "who",
        "whom",
        "where",
        "when",
        "why",
        "how",
        "many",
        "much",
        "by",
        "in",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "for",
        "of",
        "and",
        "to",
        "a",
        "an",
        "at",
        "on",
        "with",
        "from",
        "due",
        "across",
        "without",
        "did",
        "does",
        "do",
        "has",
        "have",
        "had",
        "or",
        "as",
    }
)


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
        use_hybrid: Optional[bool] = None,
        use_reranking: Optional[bool] = None,
    ) -> List[RetrievalResult]:
        """Retrieve top_k chunks relevant to the query."""
        pass


class FaissRetriever(BaseRetriever):
    """High-performance dense retriever powered by FAISS and L2-normalized vector embeddings."""

    def __init__(
        self,
        embedding_model: Optional[BaseEmbedding] = None,
        use_confidence_weighting: bool = False,
        use_hybrid: bool = True,
        bm25_k1: float = 1.5,
        bm25_b: float = 0.75,
        use_reranking: bool = True,
    ) -> None:
        self.embedding = embedding_model or DenseDeterministicEmbedding(dimension=128)
        self.use_confidence_weighting = use_confidence_weighting
        self.use_hybrid = use_hybrid
        self.use_reranking = use_reranking
        self.bm25 = BM25Index(k1=bm25_k1, b=bm25_b)
        self._lock = threading.RLock()
        self.index_faiss: Optional[faiss.IndexFlatIP] = None
        self.chunks: List[Chunk] = []

    def index(self, chunks: List[Chunk]) -> None:
        """Build FAISS inner-product index over normalized chunk embeddings."""
        next_chunks = list(chunks)
        self.bm25.index(next_chunks)

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

    def _retrieve_dense_candidates(
        self,
        query: str,
        chunks_snapshot: List[Chunk],
        index_snapshot: faiss.IndexFlatIP,
        doc_filter: Optional[Set[str]],
        search_k: int,
    ) -> Dict[str, Tuple[Chunk, float, int]]:
        query_vec = self.embedding.embed_query(query)
        query_vec = np.ascontiguousarray(query_vec, dtype=np.float32)

        raw_scores, indices = index_snapshot.search(query_vec, search_k)
        raw_scores = raw_scores[0]
        indices = indices[0]

        candidates: Dict[str, Tuple[Chunk, float, int]] = {}
        rank = 1
        for chunk_idx, score in zip(indices, raw_scores):
            if chunk_idx < 0 or chunk_idx >= len(chunks_snapshot):
                continue
            chunk = chunks_snapshot[chunk_idx]
            if doc_filter and chunk.source_doc_id not in doc_filter:
                continue
            cid = str(chunk.chunk_id)
            if cid not in candidates:
                candidates[cid] = (chunk, float(score), rank)
                rank += 1
        return candidates

    def _retrieve_dense_only(
        self,
        query: str,
        top_k: int,
        document_ids: Optional[List[str]],
    ) -> List[RetrievalResult]:
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

    def _rerank_candidates(
        self,
        query: str,
        candidates: List[RetrievalResult],
        top_k: int,
    ) -> List[RetrievalResult]:
        if not candidates:
            return []
        q_words = [w for w in bm25_tokenize(query) if w not in STOP_WORDS and len(w) > 1]
        if not q_words:
            return candidates[:top_k]
        q_lower = query.lower()
        scored = []
        for cand in candidates:
            text_lower = cand.chunk.text.lower()
            chunk_tokens = set(bm25_tokenize(text_lower))
            overlap = sum(1 for w in q_words if w in chunk_tokens) / float(len(q_words))
            phrase_bonus = 0.08 if any(f"{w1} {w2}" in text_lower for w1, w2 in zip(q_words, q_words[1:])) else 0.0
            doc_bonus = 0.15 if cand.chunk.source_doc_id.lower() in q_lower else 0.0
            boosted = 0.60 * cand.score + 0.25 * overlap + phrase_bonus + doc_bonus
            final_score = min(1.0, max(0.52, boosted))
            scored.append((final_score, cand))
        scored.sort(key=lambda x: -x[0])
        out = []
        for rank, (score, cand) in enumerate(scored[:top_k], 1):
            cand.score = round(score, 4)
            cand.rank = rank
            out.append(cand)
        return out

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        document_ids: Optional[List[str]] = None,
        use_hybrid: Optional[bool] = None,
        use_reranking: Optional[bool] = None,
    ) -> List[RetrievalResult]:
        """Search index and return ranked RetrievalResult instances using RRF hybrid fusion or dense fallback."""
        effective_hybrid = self.use_hybrid if use_hybrid is None else bool(use_hybrid)
        if not effective_hybrid:
            return self._retrieve_dense_only(query=query, top_k=top_k, document_ids=document_ids)

        with self._lock:
            chunks_snapshot = list(self.chunks)
            index_snapshot = self.index_faiss
            if not chunks_snapshot or index_snapshot is None or index_snapshot.ntotal == 0:
                return []

        doc_filter = None
        if document_ids:
            doc_filter = {d.strip() for d in document_ids if d and d.strip().lower() != "all"}
            if not doc_filter:
                doc_filter = None

        search_k = min(len(chunks_snapshot), max(top_k * 4, 50))
        dense_candidates = self._retrieve_dense_candidates(
            query=query,
            chunks_snapshot=chunks_snapshot,
            index_snapshot=index_snapshot,
            doc_filter=doc_filter,
            search_k=search_k,
        )

        bm25_scored = self.bm25.score_candidates(query=query, document_ids=document_ids)
        bm25_candidates: Dict[str, Tuple[Chunk, float, int]] = {}
        for rank_idx, (chunk, score) in enumerate(bm25_scored[:search_k]):
            cid = str(chunk.chunk_id)
            if cid not in bm25_candidates:
                bm25_candidates[cid] = (chunk, float(score), rank_idx + 1)

        all_cids = list(dict.fromkeys(list(dense_candidates.keys()) + list(bm25_candidates.keys())))
        if not all_cids:
            return []

        fused_items = []
        for cid in all_cids:
            dense_info = dense_candidates.get(cid)
            bm25_info = bm25_candidates.get(cid)

            chunk = dense_info[0] if dense_info else bm25_info[0]
            dense_rank = dense_info[2] if dense_info else None
            dense_score = dense_info[1] if dense_info else 0.0
            bm25_rank = bm25_info[2] if bm25_info else None
            bm25_score = bm25_info[1] if bm25_info else 0.0

            d_term = (61.0 / (60.0 + float(dense_rank))) if dense_rank is not None else 0.0
            b_term = (61.0 / (60.0 + float(bm25_rank))) if bm25_rank is not None else 0.0

            if dense_rank is not None and bm25_rank is not None:
                primary = max(d_term, b_term)
                secondary = min(d_term, b_term)
                normalized_rrf = 0.70 * primary + 0.30 * secondary
            else:
                present = d_term if dense_rank is not None else b_term
                normalized_rrf = 0.70 * present

            normalized_rrf = min(1.0, max(0.0, normalized_rrf))
            final_score = normalized_rrf

            if self.use_confidence_weighting:
                conf = chunk.calibrated_confidence if chunk.calibrated_confidence is not None else chunk.raw_confidence
                if chunk.is_degraded:
                    conf = min(conf, 0.40)
                final_score = 0.70 * normalized_rrf + 0.30 * conf

            rrf_raw = (
                (1.0 / (60.0 + float(dense_rank))) if dense_rank is not None else 0.0
            ) + (
                (1.0 / (60.0 + float(bm25_rank))) if bm25_rank is not None else 0.0
            )

            fused_items.append(
                (
                    chunk,
                    round(final_score, 4),
                    rrf_raw,
                    dense_score,
                    bm25_score,
                    cid,
                )
            )

        fused_items.sort(
            key=lambda x: (-x[1], -x[2], -x[3], -x[4], x[5]),
        )

        candidate_limit = min(len(fused_items), max(top_k * 3, 20))
        results: List[RetrievalResult] = []
        for rank_idx, item in enumerate(fused_items[:candidate_limit]):
            results.append(
                RetrievalResult(
                    chunk=item[0],
                    score=item[1],
                    rank=rank_idx + 1,
                )
            )

        effective_rerank = self.use_reranking if use_reranking is None else bool(use_reranking)
        if effective_rerank and len(results) > 1:
            return self._rerank_candidates(query=query, candidates=results, top_k=top_k)

        return results[:top_k]
